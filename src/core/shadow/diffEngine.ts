// © ASICBOT Private Limited Inc
// Diff Engine for Shadow Workspace

import type { DiffLine, DiffHunk, FileDiff } from './types';

/**
 * Computes the diff between two strings using Myers diff algorithm
 * Optimized for code with line-based diffing
 */
export class DiffEngine {
  /**
   * Compute a diff between original and modified content
   */
  static computeDiff(
    path: string,
    original: string | null,
    modified: string | null
  ): FileDiff {
    const isNewFile = original === null || original === '';
    const isDeleted = modified === null;

    // Handle binary detection (simple heuristic)
    const isBinary = this.detectBinary(original) || this.detectBinary(modified);
    if (isBinary) {
      return {
        path,
        hunks: [],
        additions: 0,
        deletions: 0,
        isBinary: true,
        isNewFile,
        isDeleted,
      };
    }

    const oldLines = original ? original.split('\n') : [];
    const newLines = modified ? modified.split('\n') : [];

    const hunks = this.computeHunks(oldLines, newLines);
    
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') additions++;
        else if (line.type === 'remove') deletions++;
      }
    }

    return {
      path,
      hunks,
      additions,
      deletions,
      isBinary: false,
      isNewFile,
      isDeleted,
    };
  }

  /**
   * Detect if content is likely binary
   */
  private static detectBinary(content: string | null): boolean {
    if (!content) return false;
    // Check for null bytes or high ratio of non-printable characters
    const sample = content.slice(0, 8000);
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      if (code === 0) return true; // Null byte = binary
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        nonPrintable++;
      }
    }
    return nonPrintable / sample.length > 0.1;
  }

  /**
   * Compute hunks using a simplified LCS-based diff algorithm
   */
  private static computeHunks(oldLines: string[], newLines: string[]): DiffHunk[] {
    const lcs = this.computeLCS(oldLines, newLines);
    const hunks: DiffHunk[] = [];
    
    let oldIdx = 0;
    let newIdx = 0;
    let lcsIdx = 0;
    
    let currentHunk: DiffHunk | null = null;
    const contextLines = 3; // Lines of context around changes

    const flushHunk = () => {
      if (currentHunk && currentHunk.lines.length > 0) {
        // Trim trailing unchanged lines beyond context
        while (
          currentHunk.lines.length > 0 &&
          currentHunk.lines[currentHunk.lines.length - 1].type === 'unchanged'
        ) {
          const last = currentHunk.lines[currentHunk.lines.length - 1];
          if (this.countTrailingContext(currentHunk.lines) > contextLines) {
            currentHunk.lines.pop();
            currentHunk.oldLines--;
            currentHunk.newLines--;
          } else {
            break;
          }
        }
        if (currentHunk.lines.some(l => l.type !== 'unchanged')) {
          hunks.push(currentHunk);
        }
      }
      currentHunk = null;
    };

    const ensureHunk = (oldStart: number, newStart: number) => {
      if (!currentHunk) {
        currentHunk = {
          oldStart: oldStart + 1, // 1-indexed
          oldLines: 0,
          newStart: newStart + 1,
          newLines: 0,
          lines: [],
        };
      }
    };

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      if (lcsIdx < lcs.length && oldIdx < oldLines.length && newIdx < newLines.length) {
        const [lcsOld, lcsNew] = lcs[lcsIdx];

        // Add deletions (lines in old but not in lcs)
        while (oldIdx < lcsOld) {
          ensureHunk(oldIdx, newIdx);
          currentHunk!.lines.push({
            type: 'remove',
            content: oldLines[oldIdx],
            oldLineNumber: oldIdx + 1,
          });
          currentHunk!.oldLines++;
          oldIdx++;
        }

        // Add additions (lines in new but not in lcs)
        while (newIdx < lcsNew) {
          ensureHunk(oldIdx, newIdx);
          currentHunk!.lines.push({
            type: 'add',
            content: newLines[newIdx],
            newLineNumber: newIdx + 1,
          });
          currentHunk!.newLines++;
          newIdx++;
        }

        // Add common line to current hunk if it exists
        if (currentHunk !== null) {
          const h: DiffHunk = currentHunk;
          h.lines.push({
            type: 'unchanged',
            content: oldLines[oldIdx],
            oldLineNumber: oldIdx + 1,
            newLineNumber: newIdx + 1,
          });
          h.oldLines++;
          h.newLines++;
          
          // Check if we should flush (too much context)
          if (this.countTrailingContext(h.lines) > contextLines * 2) {
            flushHunk();
          }
        }

        oldIdx++;
        newIdx++;
        lcsIdx++;
      } else {
        // Remaining deletions
        while (oldIdx < oldLines.length) {
          ensureHunk(oldIdx, newIdx);
          currentHunk!.lines.push({
            type: 'remove',
            content: oldLines[oldIdx],
            oldLineNumber: oldIdx + 1,
          });
          currentHunk!.oldLines++;
          oldIdx++;
        }

        // Remaining additions
        while (newIdx < newLines.length) {
          ensureHunk(oldIdx, newIdx);
          currentHunk!.lines.push({
            type: 'add',
            content: newLines[newIdx],
            newLineNumber: newIdx + 1,
          });
          currentHunk!.newLines++;
          newIdx++;
        }
      }
    }

    flushHunk();
    return hunks;
  }

  /**
   * Count trailing unchanged lines in a hunk
   */
  private static countTrailingContext(lines: DiffLine[]): number {
    let count = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].type === 'unchanged') count++;
      else break;
    }
    return count;
  }

  /**
   * Compute LCS (Longest Common Subsequence) indices
   * Returns array of [oldIndex, newIndex] pairs
   */
  private static computeLCS(oldLines: string[], newLines: string[]): [number, number][] {
    const m = oldLines.length;
    const n = newLines.length;

    // For very large files, use a more memory-efficient approach
    if (m * n > 10_000_000) {
      return this.computeLCSPatience(oldLines, newLines);
    }

    // Standard DP approach for smaller files
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to find LCS
    const lcs: [number, number][] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs.unshift([i - 1, j - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return lcs;
  }

  /**
   * Patience diff algorithm for large files
   * Based on unique line matching
   */
  private static computeLCSPatience(oldLines: string[], newLines: string[]): [number, number][] {
    // Find unique lines and their positions
    const oldUnique = new Map<string, number[]>();
    const newUnique = new Map<string, number[]>();

    oldLines.forEach((line, idx) => {
      if (!oldUnique.has(line)) oldUnique.set(line, []);
      oldUnique.get(line)!.push(idx);
    });

    newLines.forEach((line, idx) => {
      if (!newUnique.has(line)) newUnique.set(line, []);
      newUnique.get(line)!.push(idx);
    });

    // Find matching unique lines
    const matches: [number, number][] = [];
    for (const [line, oldIndices] of oldUnique) {
      if (oldIndices.length === 1 && newUnique.get(line)?.length === 1) {
        matches.push([oldIndices[0], newUnique.get(line)![0]]);
      }
    }

    // Sort by old index
    matches.sort((a, b) => a[0] - b[0]);

    // Find LIS (Longest Increasing Subsequence) by new index
    const lis = this.computeLIS(matches.map(m => m[1]));
    
    return lis.map(idx => matches[idx]);
  }

  /**
   * Compute Longest Increasing Subsequence indices
   */
  private static computeLIS(arr: number[]): number[] {
    if (arr.length === 0) return [];

    const n = arr.length;
    const dp = Array(n).fill(1);
    const prev = Array(n).fill(-1);

    let maxLen = 1;
    let maxIdx = 0;

    for (let i = 1; i < n; i++) {
      for (let j = 0; j < i; j++) {
        if (arr[j] < arr[i] && dp[j] + 1 > dp[i]) {
          dp[i] = dp[j] + 1;
          prev[i] = j;
        }
      }
      if (dp[i] > maxLen) {
        maxLen = dp[i];
        maxIdx = i;
      }
    }

    // Backtrack
    const result: number[] = [];
    let idx = maxIdx;
    while (idx !== -1) {
      result.unshift(idx);
      idx = prev[idx];
    }

    return result;
  }

  /**
   * Format a diff as unified diff string (for display)
   */
  static formatUnifiedDiff(diff: FileDiff): string {
    if (diff.isBinary) {
      return `Binary file ${diff.path} differs`;
    }

    const lines: string[] = [];
    lines.push(`--- a/${diff.path}`);
    lines.push(`+++ b/${diff.path}`);

    for (const hunk of diff.hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
      for (const line of hunk.lines) {
        switch (line.type) {
          case 'add':
            lines.push(`+${line.content}`);
            break;
          case 'remove':
            lines.push(`-${line.content}`);
            break;
          case 'unchanged':
            lines.push(` ${line.content}`);
            break;
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a summary of changes
   */
  static formatSummary(diff: FileDiff): string {
    if (diff.isNewFile) {
      return `+${diff.additions} lines (new file)`;
    }
    if (diff.isDeleted) {
      return `deleted`;
    }
    const parts: string[] = [];
    if (diff.additions > 0) parts.push(`+${diff.additions}`);
    if (diff.deletions > 0) parts.push(`-${diff.deletions}`);
    return parts.join(' ') || 'no changes';
  }
}

