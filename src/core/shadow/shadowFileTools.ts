// © ASICBOT Private Limited Inc
// Shadow File Tools - Routes file operations through Shadow Workspace

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ShadowWorkspace } from './shadowWorkspace';
import { DiffEngine } from './diffEngine';
import type { PendingEdit, CommitResult, PendingChangesSummary } from './types';
import { RAGIndex } from '../rag';

/**
 * Configuration for ShadowFileTools
 */
export interface ShadowFileToolsConfig {
  /** Enable shadow workspace (if false, writes directly to disk) */
  enabled: boolean;
  
  /** Auto-apply changes to disk immediately (Cursor-style workflow)
   *  When true: Write to disk immediately, track for undo
   *  When false: Propose changes, require explicit accept (original behavior)
   */
  autoApply: boolean;
  
  /** Allow file writes (if false, only reads are permitted) */
  allowFileWrites: boolean;
  
  /** Restrict operations to workspace root */
  workspaceRootOnly: boolean;
  
  /** Maximum file size to read */
  maxReadBytes: number;
  
  /** Auto-reveal edited files in editor */
  revealEditedFiles: boolean;
}

const DEFAULT_CONFIG: ShadowFileToolsConfig = {
  enabled: true,
  autoApply: true,  // Cursor-style: write immediately, allow undo
  allowFileWrites: true,
  workspaceRootOnly: true,
  maxReadBytes: 1 * 1024 * 1024, // 1 MiB
  revealEditedFiles: true, // Open files after creation
};

/**
 * ShadowFileTools provides file operations that route through the Shadow Workspace.
 * 
 * When shadow workspace is enabled:
 * - Write operations create pending edits instead of modifying disk
 * - Read operations check pending edits first, then fall back to disk
 * - Commit/reject operations are exposed for UI control
 * 
 * When shadow workspace is disabled:
 * - Operations go directly to disk (legacy behavior)
 */
export class ShadowFileTools {
  private config: ShadowFileToolsConfig;
  private shadow: ShadowWorkspace | null = null;

  constructor(config?: Partial<ShadowFileToolsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    if (this.config.enabled) {
      try {
        this.shadow = ShadowWorkspace.getInstance();
      } catch {
        // No workspace available, disable shadow mode
        this.config.enabled = false;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API - File Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a file operation based on tool name
   */
  async executeFileOperation(toolName: string, toolOutput: any): Promise<string> {
    const lower = (toolName || '').toLowerCase();
    
    try {
      const workspacePath = this.getWorkspacePath();

      // Reasoning tools (no file operations)
      if (lower === 'simple_query') {
        return this.extractAnswer(toolOutput);
      }
      if (lower === 'final_answer') {
        return this.extractFinalAnswer(toolOutput);
      }

      // File operations - route through shadow workspace if enabled
      switch (lower) {
        // Create/Write operations → Shadow
        case 'create_file':
          return this.createFile(workspacePath, toolOutput);
        case 'write_file':
          return this.writeFile(workspacePath, toolOutput);
        
        // Read operations → Check shadow first
        case 'read_file':
          return this.readFile(workspacePath, toolOutput);
        case 'open_file':
          return this.openFile(workspacePath, toolOutput);
        
        // Modify operations → Shadow
        case 'rename_file':
          return this.renameFile(workspacePath, toolOutput);
        case 'move_file':
          return this.moveFile(workspacePath, toolOutput);
        case 'copy_file':
          return this.copyFile(workspacePath, toolOutput);
        case 'delete_file':
          return this.deleteFile(workspacePath, toolOutput);

        // Directory operations
        case 'create_directory':
          return this.createDirectory(workspacePath, toolOutput);
        case 'list_files':
          return this.listFiles(workspacePath, toolOutput);
        case 'list_directories':
          return this.listDirectories(workspacePath, toolOutput);
        case 'directory_structure':
          return this.generateDirectoryStructure(workspacePath, toolOutput?.file_path);
        case 'rename_directory':
          return this.renameDirectory(workspacePath, toolOutput);
        case 'move_directory':
          return this.moveDirectory(workspacePath, toolOutput);
        case 'copy_directory':
          return this.copyDirectory(workspacePath, toolOutput);
        case 'delete_directory':
          return this.deleteDirectory(workspacePath, toolOutput);

        // Existence checks
        case 'check_file_exists':
          return this.checkFileExists(workspacePath, toolOutput);
        case 'check_directory_exists':
          return this.checkDirectoryExists(workspacePath, toolOutput);

        // Search tools
        case 'grep_search':
          return this.grepSearch(workspacePath, toolOutput);
        case 'semantic_search':
          return this.semanticSearch(workspacePath, toolOutput);

        // Terminal tools
        case 'terminal_execute':
          return this.terminalExecute(workspacePath, toolOutput);

        default:
          if (typeof toolOutput === 'object' && toolOutput && 'answer' in toolOutput) {
            return String(toolOutput.answer);
          }
          return `Operation completed: ${this.safeString(toolOutput)}`;
      }
    } catch (err) {
      return `Error executing ${toolName}: ${this.prettyError(err)}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHADOW WORKSPACE CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if there are pending changes
   */
  hasPendingChanges(): boolean {
    return this.shadow?.hasPendingChanges() ?? false;
  }

  /**
   * Get all pending edits for the current chat
   */
  getPendingEdits(): PendingEdit[] {
    return this.shadow?.getPendingEditsForCurrentChat() ?? [];
  }

  /**
   * Get all pending edits globally (all chats)
   */
  getPendingEditsGlobal(): PendingEdit[] {
    return this.shadow?.getPendingEdits() ?? [];
  }

  /**
   * Get summary of pending changes for the current chat
   */
  getPendingChangesSummary(): PendingChangesSummary | null {
    return this.shadow?.getSummary() ?? null;
  }

  /**
   * Set the current chat ID for associating edits
   */
  setCurrentChatId(chatId: string | null): void {
    this.shadow?.setCurrentChatId(chatId);
  }

  /**
   * Get the current chat ID
   */
  getCurrentChatId(): string | null {
    return this.shadow?.getCurrentChatId() ?? null;
  }

  /**
   * Get formatted diff for a pending edit
   */
  getFormattedDiff(relativePath: string): string | null {
    if (!this.shadow) return null;
    const diff = this.shadow.getDiff(relativePath);
    if (!diff) return null;
    return DiffEngine.formatUnifiedDiff(diff);
  }

  /**
   * Accept a single pending edit
   */
  async acceptEdit(editId: string): Promise<CommitResult> {
    if (!this.shadow) {
      return {
        success: false,
        committedPaths: [],
        failedPaths: [{ path: 'unknown', error: 'Shadow workspace not enabled' }],
        summary: 'Shadow workspace not enabled',
      };
    }
    return this.shadow.acceptEdit(editId);
  }

  /**
   * Accept all pending edits
   */
  async acceptAll(): Promise<CommitResult> {
    if (!this.shadow) {
      return {
        success: false,
        committedPaths: [],
        failedPaths: [],
        summary: 'Shadow workspace not enabled',
      };
    }
    return this.shadow.acceptAll();
  }

  /**
   * Reject/Undo a single pending edit (restores original file state)
   */
  async rejectEdit(editId: string): Promise<boolean> {
    return (await this.shadow?.rejectEdit(editId)) ?? false;
  }

  /**
   * Reject/Undo all pending edits (restores all original file states)
   */
  async rejectAll(): Promise<void> {
    await this.shadow?.rejectAll();
  }

  /**
   * Clear all pending edits and snapshots
   */
  clear(): void {
    this.shadow?.clear();
  }

  /**
   * Subscribe to shadow workspace events
   */
  onShadowEvent(listener: (event: any) => void): () => void {
    if (!this.shadow) return () => {};
    return this.shadow.onEvent(listener);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE OPERATIONS (Private)
  // ═══════════════════════════════════════════════════════════════════════════

  private async createFile(workspacePath: string, args: any): Promise<string> {
    this.requireWrites();
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const content = typeof args?.content === 'string' ? args.content : '';
    const filePath = this.resolveSafe(workspacePath, rel);

    if (this.shadow && this.config.enabled) {
      if (this.config.autoApply) {
        // Cursor-style: Write immediately, track for undo
        // First, track the original state (file doesn't exist)
        await this.shadow.trackCreate(rel, content, `Create ${rel}`);
        
        // Write to disk
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf8');
        
        // Open in editor
        await this.tryReveal(filePath);
        
        const lineCount = content.split('\n').length;
        return `✅ Created: ${rel} (+${lineCount} lines)\n\n💡 Use "Undo" in the changes panel to revert.`;
      } else {
        // Legacy mode: propose changes, require explicit accept
        const edit = await this.shadow.proposeCreate(rel, content, `Create ${rel}`);
        const diff = edit.diff;
        const summary = diff ? `+${diff.additions} lines` : '';
        return `📝 Proposed: Create ${rel} ${summary}\n\n⚠️ Changes are pending. Use "Keep All" or "Review" to apply.`;
      }
    }

    // Direct write (shadow disabled)
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    if (this.config.revealEditedFiles) await this.tryReveal(filePath);
    return `✅ File created: ${rel}`;
  }

  private async writeFile(workspacePath: string, args: any): Promise<string> {
    this.requireWrites();
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const content = typeof args?.content === 'string' ? args.content : '';
    const filePath = this.resolveSafe(workspacePath, rel);

    if (this.shadow && this.config.enabled) {
      if (this.config.autoApply) {
        // Cursor-style: Write immediately, track for undo
        // Track the original state first
        const originalExists = await this.fileExists(filePath);
        const originalContent = originalExists ? await fs.readFile(filePath, 'utf8') : null;
        
        await this.shadow.trackModify(rel, originalContent, content, `Modify ${rel}`);
        
        // Write to disk
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf8');
        
        // Open in editor
        await this.tryReveal(filePath);
        
        // Calculate diff stats
        const oldLines = originalContent?.split('\n').length ?? 0;
        const newLines = content.split('\n').length;
        const added = Math.max(0, newLines - oldLines);
        const removed = Math.max(0, oldLines - newLines);
        
        let summary = '';
        if (added > 0) summary += `+${added}`;
        if (removed > 0) summary += (summary ? ' ' : '') + `-${removed}`;
        
        return `✅ Modified: ${rel} ${summary ? `(${summary} lines)` : ''}\n\n💡 Use "Undo" in the changes panel to revert.`;
      } else {
        // Legacy mode: propose changes, require explicit accept
        const edit = await this.shadow.proposeModify(rel, content, `Modify ${rel}`);
        const diff = edit.diff;
        const summary = diff ? `+${diff.additions} -${diff.deletions} lines` : '';
        return `📝 Proposed: Modify ${rel} ${summary}\n\n⚠️ Changes are pending. Use "Keep All" or "Review" to apply.`;
      }
    }

    // Direct write (shadow disabled)
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    if (this.config.revealEditedFiles) await this.tryReveal(filePath);
    return `✏️ Wrote file: ${rel}`;
  }
  
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async readFile(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');

    // Check shadow workspace first for pending content
    if (this.shadow && this.config.enabled) {
      const effectiveContent = await this.shadow.getEffectiveContent(rel);
      if (effectiveContent !== null) {
        const isPending = this.shadow.getPendingEdit(rel) !== undefined;
        const prefix = isPending ? '**File: ${rel}** (pending changes)\n\n' : `**File: ${rel}**\n\n`;
        return prefix + effectiveContent;
      }
    }

    // Read from disk
    const filePath = this.resolveSafe(workspacePath, rel);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return `⚠️ Not a regular file: ${rel}`;

    if (stat.size > this.config.maxReadBytes) {
      const head = await this.readHead(filePath, Math.min(this.config.maxReadBytes, 64 * 1024));
      return `**File: ${rel}** (size: ${stat.size} bytes — showing first ${head.length} bytes)\n\n${head}`;
    }

    const content = await fs.readFile(filePath, 'utf8');
    return `**File: ${rel}**\n\n${content}`;
  }

  private async openFile(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const filePath = this.resolveSafe(workspacePath, rel);
    await this.tryReveal(filePath);
    return `📂 Opened file: ${rel}`;
  }

  private async deleteFile(workspacePath: string, args: any): Promise<string> {
    this.requireWrites();
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const filePath = this.resolveSafe(workspacePath, rel);

    if (this.shadow && this.config.enabled) {
      if (this.config.autoApply) {
        // Track original content before deletion
        const originalContent = await fs.readFile(filePath, 'utf8').catch(() => null);
        
        await this.shadow.trackDelete(rel, originalContent, `Delete ${rel}`);
        
        // Delete from disk
        await fs.unlink(filePath);
        
        const lineCount = originalContent?.split('\n').length ?? 0;
        return `🗑️ Deleted: ${rel} (-${lineCount} lines)\n\n💡 Use "Undo" in the changes panel to restore.`;
      } else {
        const edit = await this.shadow.proposeDelete(rel, `Delete ${rel}`);
        const diff = edit.diff;
        const summary = diff ? `-${diff.deletions} lines` : '';
        return `📝 Proposed: Delete ${rel} ${summary}\n\n⚠️ Changes are pending. Use "Keep All" or "Review" to apply.`;
      }
    }

    await fs.unlink(filePath);
    return `🗑️ Deleted file: ${rel}`;
  }

  private async renameFile(workspacePath: string, args: any): Promise<string> {
    this.requireWrites();
    const oldRel = this.requireStringArg(args?.old_file_path, 'old_file_path');
    const newRel = this.requireStringArg(args?.new_file_path, 'new_file_path');

    if (this.shadow && this.config.enabled) {
      await this.shadow.proposeRename(oldRel, newRel, `Rename ${oldRel} → ${newRel}`);
      return `📝 Proposed: Rename ${oldRel} → ${newRel}\n\n⚠️ Changes are pending.`;
    }

    const oldPath = this.resolveSafe(workspacePath, oldRel);
    const newPath = this.resolveSafe(workspacePath, newRel);
    await fs.mkdir(path.dirname(newPath), { recursive: true });
    await fs.rename(oldPath, newPath);
    if (this.config.revealEditedFiles) await this.tryReveal(newPath);
    return `🔄 Renamed: ${oldRel} → ${newRel}`;
  }

  private async moveFile(workspacePath: string, args: any): Promise<string> {
    this.requireWrites();
    const srcRel = this.requireStringArg(args?.source_file_path, 'source_file_path');
    const dstRel = this.requireStringArg(args?.destination_file_path, 'destination_file_path');

    // For now, move is similar to rename in shadow workspace
    if (this.shadow && this.config.enabled) {
      await this.shadow.proposeRename(srcRel, dstRel, `Move ${srcRel} → ${dstRel}`);
      return `📝 Proposed: Move ${srcRel} → ${dstRel}\n\n⚠️ Changes are pending.`;
    }

    const src = this.resolveSafe(workspacePath, srcRel);
    const dst = this.resolveSafe(workspacePath, dstRel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
    if (this.config.revealEditedFiles) await this.tryReveal(dst);
    return `📦 Moved file: ${srcRel} → ${dstRel}`;
  }

  private async copyFile(workspacePath: string, args: any): Promise<string> {
    this.requireWrites();
    const srcRel = this.requireStringArg(args?.source_file_path, 'source_file_path');
    const dstRel = this.requireStringArg(args?.destination_file_path, 'destination_file_path');

    // For copy, we need to read source and propose create at destination
    if (this.shadow && this.config.enabled) {
      const srcPath = this.resolveSafe(workspacePath, srcRel);
      const content = await fs.readFile(srcPath, 'utf8');
      await this.shadow.proposeCreate(dstRel, content, `Copy ${srcRel} → ${dstRel}`);
      return `📝 Proposed: Copy ${srcRel} → ${dstRel}\n\n⚠️ Changes are pending.`;
    }

    const src = this.resolveSafe(workspacePath, srcRel);
    const dst = this.resolveSafe(workspacePath, dstRel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
    if (this.config.revealEditedFiles) await this.tryReveal(dst);
    return `📑 Copied file: ${srcRel} → ${dstRel}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DIRECTORY OPERATIONS (Direct - not shadowed)
  // ═══════════════════════════════════════════════════════════════════════════

  private async createDirectory(workspacePath: string, args: any): Promise<string> {
    this.requireWrites();
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const dir = this.resolveSafe(workspacePath, rel);
    await fs.mkdir(dir, { recursive: true });
    return `📁 Directory created: ${rel}`;
  }

  private async listFiles(workspacePath: string, args: any): Promise<string> {
    const relDir = typeof args?.file_path === 'string' && args.file_path.trim() ? args.file_path : '.';
    const dirPath = this.resolveSafe(workspacePath, relDir);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries.filter(e => !e.isDirectory()).map(e => e.name).sort();
    if (files.length === 0) return `📋 No files in ${relDir}`;
    return `Files in ${relDir}:\n\n${files.map(n => `📄 ${n}`).join('\n')}`;
  }

  private async listDirectories(workspacePath: string, args: any): Promise<string> {
    const relDir = typeof args?.file_path === 'string' && args.file_path.trim() ? args.file_path : '.';
    const dirPath = this.resolveSafe(workspacePath, relDir);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
    if (dirs.length === 0) return `📂 No subdirectories in ${relDir}`;
    return `Directories in ${relDir}:\n\n${dirs.map(n => `📁 ${n}`).join('\n')}`;
  }

  private async renameDirectory(workspacePath: string, args: any): Promise<string> {
    this.requireWrites();
    const oldRel = this.requireStringArg(args?.old_file_path, 'old_file_path');
    const newRel = this.requireStringArg(args?.new_file_path, 'new_file_path');
    const oldPath = this.resolveSafe(workspacePath, oldRel);
    const newPath = this.resolveSafe(workspacePath, newRel);
    await fs.mkdir(path.dirname(newPath), { recursive: true });
    await fs.rename(oldPath, newPath);
    return `🔄 Renamed directory: ${oldRel} → ${newRel}`;
  }

  private async moveDirectory(workspacePath: string, args: any): Promise<string> {
    this.requireWrites();
    const srcRel = this.requireStringArg(args?.source_file_path, 'source_file_path');
    const dstRel = this.requireStringArg(args?.destination_file_path, 'destination_file_path');
    const src = this.resolveSafe(workspacePath, srcRel);
    const dst = this.resolveSafe(workspacePath, dstRel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
    return `📦 Moved directory: ${srcRel} → ${dstRel}`;
  }

  private async copyDirectory(workspacePath: string, args: any): Promise<string> {
    this.requireWrites();
    const srcRel = this.requireStringArg(args?.source_file_path, 'source_file_path');
    const dstRel = this.requireStringArg(args?.destination_file_path, 'destination_file_path');
    const src = this.resolveSafe(workspacePath, srcRel);
    const dst = this.resolveSafe(workspacePath, dstRel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    const cp = (fs as any).cp;
    if (typeof cp === 'function') await cp(src, dst, { force: true, recursive: true });
    else throw new Error('Recursive copy not supported on this Node version');
    return `📑 Copied directory: ${srcRel} → ${dstRel}`;
  }

  private async deleteDirectory(workspacePath: string, args: any): Promise<string> {
    this.requireWrites();
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const dirPath = this.resolveSafe(workspacePath, rel);
    await fs.rm(dirPath, { recursive: true, force: true });
    return `🗑️ Deleted directory: ${rel}`;
  }

  private async checkFileExists(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    
    // Check pending edits first
    if (this.shadow && this.config.enabled) {
      const edit = this.shadow.getPendingEdit(rel);
      if (edit) {
        if (edit.operationType === 'delete') {
          return `⚠️ File pending deletion: ${rel}`;
        }
        return `✅ File exists (pending): ${rel}`;
      }
    }

    const filePath = this.resolveSafe(workspacePath, rel);
    try {
      const st = await fs.stat(filePath);
      return st.isFile() ? `✅ File exists: ${rel}` : `⚠️ Not a file: ${rel}`;
    } catch {
      return `❌ File does not exist: ${rel}`;
    }
  }

  private async checkDirectoryExists(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const dirPath = this.resolveSafe(workspacePath, rel);
    try {
      const st = await fs.stat(dirPath);
      return st.isDirectory() ? `✅ Directory exists: ${rel}` : `⚠️ Not a directory: ${rel}`;
    } catch {
      return `❌ Directory does not exist: ${rel}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  private async grepSearch(workspacePath: string, args: any): Promise<string> {
    const pattern = typeof args?.pattern === 'string' ? args.pattern.trim() : '';
    const searchPath = typeof args?.file_path === 'string' ? args.file_path.trim() : '.';
    const fileGlob = typeof args?.file_glob === 'string' ? args.file_glob.trim() : '';
    const caseSensitive = args?.case_sensitive === 'true';

    if (!pattern) {
      return '❌ Error: No search pattern provided';
    }

    const targetPath = this.resolveSafe(workspacePath, searchPath || '.');
    
    try {
      // Build regex
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
      } catch (e) {
        return `❌ Invalid regex pattern: ${pattern}`;
      }

      const results: string[] = [];
      const maxResults = 100;
      const maxFileSize = 1024 * 1024; // 1 MiB

      // Recursively search files
      await this.searchFiles(targetPath, workspacePath, regex, fileGlob, results, maxResults, maxFileSize);

      if (results.length === 0) {
        return `🔍 No matches found for pattern: \`${pattern}\`\n\nSearched in: ${searchPath}${fileGlob ? ` (files: ${fileGlob})` : ''}`;
      }

      const header = `🔍 **Found ${results.length}${results.length >= maxResults ? '+' : ''} matches** for \`${pattern}\`\n\n`;
      return header + results.join('\n');
    } catch (e) {
      return `❌ Search error: ${this.prettyError(e)}`;
    }
  }

  private async searchFiles(
    dirPath: string,
    workspacePath: string,
    regex: RegExp,
    fileGlob: string,
    results: string[],
    maxResults: number,
    maxFileSize: number
  ): Promise<void> {
    if (results.length >= maxResults) return;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = path.join(dirPath, entry.name);
        const relPath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');

        // Skip common non-searchable directories
        if (entry.isDirectory()) {
          const skipDirs = ['node_modules', '.git', '.venv', '__pycache__', 'dist', 'out', 'build', '.cache'];
          if (skipDirs.includes(entry.name)) continue;
          
          await this.searchFiles(fullPath, workspacePath, regex, fileGlob, results, maxResults, maxFileSize);
          continue;
        }

        // Skip non-matching globs
        if (fileGlob && !this.matchGlob(entry.name, fileGlob)) continue;

        // Skip binary/large files
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > maxFileSize) continue;
          if (this.isBinaryFile(entry.name)) continue;

          const content = await fs.readFile(fullPath, 'utf8');
          const lines = content.split('\n');
          
          for (let i = 0; i < lines.length && results.length < maxResults; i++) {
            const line = lines[i];
            regex.lastIndex = 0; // Reset for global regex
            if (regex.test(line)) {
              const lineNum = i + 1;
              const trimmedLine = line.trim().substring(0, 120);
              results.push(`**${relPath}:${lineNum}** ${trimmedLine}`);
            }
          }
        } catch {
          // Skip files that can't be read
        }
      }
    } catch {
      // Skip directories that can't be read
    }
  }

  private matchGlob(filename: string, glob: string): boolean {
    // Simple glob matching: *.sv, *.v, *.py, etc.
    if (glob.startsWith('*.')) {
      const ext = glob.slice(1); // .sv, .v, .py
      return filename.endsWith(ext);
    }
    return filename.includes(glob);
  }

  private isBinaryFile(filename: string): boolean {
    const binaryExts = [
      '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a',
      '.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.webp',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.zip', '.tar', '.gz', '.rar', '.7z',
      '.mp3', '.mp4', '.avi', '.mov', '.mkv',
      '.woff', '.woff2', '.ttf', '.eot',
      '.pyc', '.pyo', '.class',
    ];
    const ext = path.extname(filename).toLowerCase();
    return binaryExts.includes(ext);
  }

  /**
   * Semantic search using RAG index
   */
  private async semanticSearch(workspacePath: string, args: any): Promise<string> {
    const query = typeof args?.query === 'string' ? args.query.trim() : '';
    const pathPrefix = typeof args?.path_prefix === 'string' ? args.path_prefix.trim() : '';
    const topKStr = typeof args?.top_k === 'string' ? args.top_k.trim() : '10';
    const language = typeof args?.language === 'string' ? args.language.trim() : '';

    if (!query) {
      return '❌ Error: No search query provided. Use a complete question like "How does the AXI agent work?"';
    }

    const topK = parseInt(topKStr, 10) || 10;

    try {
      // Get or initialize the RAG index
      const ragIndex = RAGIndex.getInstance(workspacePath);
      await ragIndex.initialize();

      // Check if index exists
      if (!ragIndex.isIndexed()) {
        // Build the index first
        const stats = await ragIndex.buildIndex((msg, percent) => {
          // Progress callback (could emit to UI)
          console.log(`[RAG] ${msg} (${percent}%)`);
        });
        
        if (stats.totalChunks === 0) {
          return '📚 Index is empty. No supported files found in the workspace.\n\nSupported file types: .sv, .svh, .v, .vh, .py, .ts, .tsx, .js, .jsx';
        }
      }

      // Perform the search
      const results = await ragIndex.search(query, {
        topK,
        pathPrefix: pathPrefix || undefined,
        language: language || undefined,
        minScore: 0.15,
      });

      if (results.length === 0) {
        return `🔍 No results found for: "${query}"\n\nTry rephrasing your question or using grep_search for exact text matching.`;
      }

      // Format results
      let output = `🧠 **Semantic Search Results** for: "${query}"\n\n`;
      output += `Found ${results.length} relevant code sections:\n\n`;

      for (let i = 0; i < results.length; i++) {
        const { chunk, score, highlight } = results[i];
        const scorePercent = Math.round(score * 100);
        
        output += `---\n\n`;
        output += `**${i + 1}. ${chunk.filePath}** (${chunk.startLine}-${chunk.endLine}) — ${scorePercent}% match\n`;
        
        if (chunk.signature) {
          output += `\`${chunk.signature}\`\n`;
        }
        
        output += `\n\`\`\`${chunk.language}\n`;
        // Show first ~20 lines of the chunk
        const lines = chunk.content.split('\n');
        const preview = lines.slice(0, 20).join('\n');
        output += preview;
        if (lines.length > 20) {
          output += `\n... (${lines.length - 20} more lines)`;
        }
        output += '\n```\n\n';
      }

      // Add stats
      const stats = ragIndex.getStats();
      output += `---\n\n📊 *Index: ${stats.totalFiles} files, ${stats.totalChunks} chunks*`;

      return output;
    } catch (e) {
      return `❌ Semantic search error: ${this.prettyError(e)}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TERMINAL TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  private async terminalExecute(workspacePath: string, args: any): Promise<string> {
    const command = typeof args?.command === 'string' ? args.command.trim() : '';
    const workingDir = typeof args?.working_directory === 'string' ? args.working_directory.trim() : '.';
    const timeoutStr = typeof args?.timeout_seconds === 'string' ? args.timeout_seconds.trim() : '30';

    if (!command) {
      return '❌ Error: No command provided';
    }

    // Parse timeout
    let timeoutMs = 30000;
    const parsedTimeout = parseInt(timeoutStr, 10);
    if (!isNaN(parsedTimeout) && parsedTimeout > 0) {
      timeoutMs = parsedTimeout * 1000;
    } else if (parsedTimeout === 0) {
      timeoutMs = 0; // No timeout
    }

    // Validate and resolve working directory
    const cwd = this.resolveSafe(workspacePath, workingDir || '.');

    // Safety: Block dangerous commands
    const dangerousPatterns = [
      /^\s*sudo\b/i,
      /^\s*rm\s+-rf\s+[\/~]/i,
      /^\s*:(){ :|:& };:/,  // Fork bomb
      />\s*\/dev\/sd/i,
      /mkfs\b/i,
      /dd\s+.*of=\/dev/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return `❌ Command blocked for safety: ${command}`;
      }
    }

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const result = await execAsync(command, {
        cwd,
        timeout: timeoutMs || undefined,
        maxBuffer: 1024 * 1024, // 1 MiB
        env: {
          ...process.env,
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
      });

      const stdout = (result.stdout || '').trim();
      const stderr = (result.stderr || '').trim();

      let output = `🖥️ **Command:** \`${command}\`\n`;
      output += `📁 **Working directory:** ${workingDir}\n\n`;

      if (stdout) {
        output += `**Output:**\n\`\`\`\n${stdout.substring(0, 8000)}\n\`\`\`\n`;
      }
      if (stderr) {
        output += `**Stderr:**\n\`\`\`\n${stderr.substring(0, 2000)}\n\`\`\`\n`;
      }
      if (!stdout && !stderr) {
        output += `✅ Command completed with no output.`;
      }

      return output;
    } catch (e: any) {
      const error = e as { stdout?: string; stderr?: string; message?: string; killed?: boolean; code?: number };
      
      let output = `🖥️ **Command:** \`${command}\`\n`;
      output += `📁 **Working directory:** ${workingDir}\n\n`;

      if (error.killed) {
        output += `⏱️ **Timeout:** Command exceeded ${timeoutMs / 1000}s limit\n`;
      }

      if (error.stdout) {
        output += `**Output:**\n\`\`\`\n${error.stdout.substring(0, 4000)}\n\`\`\`\n`;
      }
      if (error.stderr) {
        output += `**Error:**\n\`\`\`\n${error.stderr.substring(0, 4000)}\n\`\`\`\n`;
      }
      if (error.code !== undefined) {
        output += `\n❌ **Exit code:** ${error.code}`;
      }
      if (!error.stdout && !error.stderr && error.message) {
        output += `❌ **Error:** ${error.message}`;
      }

      return output;
    }
  }

  async generateDirectoryStructure(workspacePath: string, relPath: string = '.'): Promise<string> {
    try {
      const dirPath = this.resolveSafe(workspacePath, relPath);
      return await this.buildDirectoryTree(dirPath, relPath);
    } catch (e: any) {
      return `Error generating directory structure: ${this.prettyError(e)}`;
    }
  }

  private async buildDirectoryTree(dirPath: string, relPath: string, depth: number = 0): Promise<string> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const sortedEntries = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      let tree = '';
      const indent = '│   '.repeat(depth);
      const lastIndent = '    '.repeat(depth);

      for (let i = 0; i < sortedEntries.length; i++) {
        const entry = sortedEntries[i];
        const isLast = i === sortedEntries.length - 1;
        const currentIndent = isLast ? lastIndent : indent;
        const connector = isLast ? '└──' : '├──';
        
        if (entry.isDirectory()) {
          tree += `${currentIndent}${connector}${entry.name}/\n`;
          const subDirPath = path.join(dirPath, entry.name);
          const subTree = await this.buildDirectoryTree(subDirPath, path.join(relPath, entry.name), depth + 1);
          tree += subTree;
        } else {
          // Check if file has pending changes
          const fullRelPath = path.join(relPath, entry.name).replace(/\\/g, '/');
          const pending = this.shadow?.getPendingEdit(fullRelPath);
          const marker = pending ? ' *' : '';
          tree += `${currentIndent}${connector}${entry.name}${marker}\n`;
        }
      }

      return tree;
    } catch (error) {
      const currentIndent = '│   '.repeat(depth);
      return `${currentIndent}└──[Error reading directory: ${error}]\n`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  getWorkspacePath(): string {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) throw new Error('No workspace folder found');
    return ws.uri.fsPath;
  }

  isFinalResponse(toolName: string, toolOutput: any): boolean {
    const t = (toolName || '').toLowerCase();
    if (t === 'simple_query') {
      const ans = typeof toolOutput?.answer === 'string' ? toolOutput.answer : '';
      const fin = typeof toolOutput?.final_answer === 'string' ? toolOutput.final_answer : '';
      return (ans || fin || '').trim().length > 0;
    }
    if (t === 'final_answer') {
      const fin = typeof toolOutput?.final_answer === 'string' ? toolOutput.final_answer : '';
      return fin.trim().length > 0;
    }
    const finals = new Set(['respond', 'final_response', 'complete']);
    if (finals.has(t)) return true;
    if (toolOutput && typeof toolOutput === 'object' && (toolOutput as any).final === true) return true;
    if (t === 'directory_structure') return false;
    return false;
  }

  formatProgressMessage(toolName: string, result: string, step: number): string {
    const map: Record<string, string> = {
      simple_query: '💭',
      final_answer: '✅',
      create_file: '📝', open_file: '📂', read_file: '📖', write_file: '✏️',
      rename_file: '🔄', move_file: '📦', copy_file: '📑', delete_file: '🗑️',
      create_directory: '📁', list_files: '📋', list_directories: '📂', directory_structure: '📁',
      rename_directory: '🔄', move_directory: '📦', copy_directory: '📑', delete_directory: '🗑️',
      check_file_exists: '🔍', check_directory_exists: '🔎',
      // Search tools
      grep_search: '🔍',
      semantic_search: '🧠',
      // Terminal tools
      terminal_execute: '🖥️',
    };
    const key = (toolName || '').toLowerCase();
    const emoji = map[key] || '⚙️';
    const title = (toolName || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `${emoji} **Step ${step}: ${title}**\n\n${result}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private extractAnswer(toolOutput: any): string {
    const ans = typeof toolOutput?.answer === 'string' ? toolOutput.answer : '';
    const fin = typeof toolOutput?.final_answer === 'string' ? toolOutput.final_answer : '';
    const text = (ans || fin || (typeof toolOutput === 'string' ? toolOutput : '')).trim();
    return text || '(no answer produced)';
  }

  private extractFinalAnswer(toolOutput: any): string {
    const fin = typeof toolOutput?.final_answer === 'string' ? toolOutput.final_answer : '';
    const text = (fin || (typeof toolOutput === 'string' ? toolOutput : '')).trim();
    return text || '(no answer produced)';
  }

  private requireWrites(): void {
    if (!this.config.allowFileWrites) {
      throw new Error('Writes are disabled by settings');
    }
  }

  private resolveSafe(workspacePath: string, rel: string): string {
    const normalizedRel = this.normalizeRel(rel);
    const abs = path.resolve(workspacePath, normalizedRel);
    if (this.config.workspaceRootOnly) {
      const wsNorm = this.normalizeAbs(workspacePath);
      const absNorm = this.normalizeAbs(abs);
      if (!absNorm.startsWith(wsNorm)) throw new Error(`Path escapes workspace: "${rel}"`);
    }
    return abs;
  }

  private normalizeRel(p: string): string {
    if (!p || typeof p !== 'string') throw new Error('Invalid path');
    let trimmed = p.trim();
    // Strip quotes/backticks
    trimmed = trimmed.replace(/^([`'"])(.*)\1$/s, '$2');
    if (trimmed.includes('```')) {
      trimmed = trimmed.split('\n')
        .filter(l => !/^```/.test(l.trim()))
        .join('\n')
        .trim();
    }
    trimmed = trimmed.replace(/^[`'"]+|[`'"]+$/g, '');
    if (!trimmed) throw new Error('Empty path');
    if (path.isAbsolute(trimmed)) throw new Error('Absolute paths are not allowed');
    return trimmed.replace(/\\/g, '/');
  }

  private normalizeAbs(p: string): string {
    const full = path.resolve(p);
    return full.endsWith(path.sep) ? full : full + path.sep;
  }

  private requireStringArg(value: unknown, argName: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing or invalid "${argName}"`);
    return this.normalizeRel(value);
  }

  private async tryReveal(absFilePath: string): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absFilePath));
      // preview: false - keeps the file open (not replaced by next file)
      // preserveFocus: true - don't steal focus from current editor
      await vscode.window.showTextDocument(doc, { 
        preview: false,      // Keep file open in a permanent tab
        preserveFocus: false // Focus the new file (user expects to see it)
      });
    } catch { /* non-fatal */ }
  }

  private async readHead(absFilePath: string, maxBytes: number): Promise<string> {
    const buf = await fs.readFile(absFilePath);
    const head = buf.subarray(0, maxBytes);
    try { return head.toString('utf8'); } catch { return `<<binary ${head.length} bytes>>`; }
  }

  private safeString(v: unknown): string {
    try { return typeof v === 'string' ? v : JSON.stringify(v); }
    catch { return String(v); }
  }

  private prettyError(err: unknown): string {
    if (err instanceof Error) return err.message;
    try { return JSON.stringify(err); } catch { return String(err); }
  }
}

