// © ASICBOT Private Limited Inc
// Shadow Workspace Manager - Core implementation

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DiffEngine } from './diffEngine';
import type {
  FileOperationType,
  FileSnapshot,
  PendingEdit,
  PendingChangesSummary,
  ShadowWorkspaceEvent,
  ShadowWorkspaceListener,
  ShadowWorkspaceOptions,
  CommitResult,
  FileDiff,
} from './types';

/**
 * ShadowWorkspace provides a virtual layer for speculative file operations.
 * 
 * Key Features:
 * - Intercepts file operations and stores them in memory
 * - Provides diff preview before committing
 * - Supports granular accept/reject of individual files
 * - Maintains original file snapshots for safe rollback
 * 
 * Usage Flow:
 * 1. Agent proposes file changes via proposeCreate/proposeModify/proposeDelete
 * 2. UI displays pending changes with diffs
 * 3. User can accept/reject individual files or all changes
 * 4. On accept, changes are committed to disk
 */
export class ShadowWorkspace {
  private static instance: ShadowWorkspace | null = null;

  private workspacePath: string;
  private pendingEdits: Map<string, PendingEdit> = new Map();
  private snapshots: Map<string, FileSnapshot> = new Map();
  private listeners: Set<ShadowWorkspaceListener> = new Set();
  private options: Required<ShadowWorkspaceOptions>;
  private editCounter = 0;

  private currentChatId: string | null = null;

  private constructor(workspacePath: string, options?: ShadowWorkspaceOptions) {
    this.workspacePath = workspacePath;
    this.options = {
      maxPendingEdits: options?.maxPendingEdits ?? 100,
      autoSnapshot: options?.autoSnapshot ?? true,
      computeDiffsEagerly: options?.computeDiffsEagerly ?? true,
    };
  }

  /**
   * Set the current chat ID for associating edits
   */
  setCurrentChatId(chatId: string | null): void {
    this.currentChatId = chatId;
  }

  /**
   * Get the current chat ID
   */
  getCurrentChatId(): string | null {
    return this.currentChatId;
  }

  /**
   * Get or create the singleton instance
   */
  static getInstance(workspacePath?: string): ShadowWorkspace {
    if (!ShadowWorkspace.instance) {
      const wsPath = workspacePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsPath) {
        throw new Error('No workspace folder available');
      }
      ShadowWorkspace.instance = new ShadowWorkspace(wsPath);
    }
    return ShadowWorkspace.instance;
  }

  /**
   * Reset the singleton (useful for testing)
   */
  static reset(): void {
    ShadowWorkspace.instance = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRACK OPERATIONS (Auto-apply mode - files already written to disk)
  // For undo capability: store what was changed so it can be reverted
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Track a file creation that has already been written to disk.
   * For undo: delete the created file.
   */
  async trackCreate(
    relativePath: string,
    content: string,
    description?: string
  ): Promise<PendingEdit> {
    const edit = this.createPendingEdit({
      path: relativePath,
      operationType: 'create',
      originalContent: null, // File didn't exist before
      newContent: content,
      description: description ?? `Created ${relativePath}`,
    });

    // Mark as "applied" since it's already on disk
    edit.status = 'pending'; // Still pending for undo purposes
    this.addPendingEdit(edit);
    return edit;
  }

  /**
   * Track a file modification that has already been written to disk.
   * For undo: restore the original content.
   */
  async trackModify(
    relativePath: string,
    originalContent: string | null,
    newContent: string,
    description?: string
  ): Promise<PendingEdit> {
    // If there's no original content, this was actually a create
    const operationType = originalContent === null ? 'create' : 'modify';
    
    const edit = this.createPendingEdit({
      path: relativePath,
      operationType,
      originalContent,
      newContent,
      description: description ?? `Modified ${relativePath}`,
    });

    edit.status = 'pending';
    this.addPendingEdit(edit);
    return edit;
  }

  /**
   * Track a file deletion that has already been done.
   * For undo: recreate the file with original content.
   */
  async trackDelete(
    relativePath: string,
    originalContent: string | null,
    description?: string
  ): Promise<PendingEdit> {
    const edit = this.createPendingEdit({
      path: relativePath,
      operationType: 'delete',
      originalContent,
      newContent: null, // File no longer exists
      description: description ?? `Deleted ${relativePath}`,
    });

    edit.status = 'pending';
    this.addPendingEdit(edit);
    return edit;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROPOSE OPERATIONS (Create pending edits)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Propose creating a new file
   */
  async proposeCreate(
    relativePath: string,
    content: string,
    description?: string
  ): Promise<PendingEdit> {
    const absPath = this.resolvePath(relativePath);
    
    // Check if file already exists
    let originalContent: string | null = null;
    let operationType: FileOperationType = 'create';
    
    try {
      originalContent = await fs.readFile(absPath, 'utf8');
      operationType = 'modify'; // File exists, this is a modification
    } catch {
      // File doesn't exist, this is a creation
    }

    const edit = this.createPendingEdit({
      path: relativePath,
      operationType,
      originalContent,
      newContent: content,
      description: description ?? `Create ${relativePath}`,
    });

    this.addPendingEdit(edit);
    return edit;
  }

  /**
   * Propose modifying an existing file
   */
  async proposeModify(
    relativePath: string,
    newContent: string,
    description?: string
  ): Promise<PendingEdit> {
    const absPath = this.resolvePath(relativePath);
    
    // Get current content (or snapshot if we have one)
    let originalContent: string | null = null;
    const existingSnapshot = this.snapshots.get(relativePath);
    
    if (existingSnapshot) {
      originalContent = existingSnapshot.content;
    } else {
      try {
        originalContent = await fs.readFile(absPath, 'utf8');
        // Auto-snapshot for potential future rollbacks
        if (this.options.autoSnapshot) {
          await this.snapshotFile(relativePath);
        }
      } catch {
        // File doesn't exist yet
      }
    }

    const edit = this.createPendingEdit({
      path: relativePath,
      operationType: originalContent === null ? 'create' : 'modify',
      originalContent,
      newContent: newContent,
      description: description ?? `Modify ${relativePath}`,
    });

    this.addPendingEdit(edit);
    return edit;
  }

  /**
   * Propose deleting a file
   */
  async proposeDelete(
    relativePath: string,
    description?: string
  ): Promise<PendingEdit> {
    const absPath = this.resolvePath(relativePath);
    
    // Get current content for diff display
    let originalContent: string | null = null;
    try {
      originalContent = await fs.readFile(absPath, 'utf8');
      if (this.options.autoSnapshot) {
        await this.snapshotFile(relativePath);
      }
    } catch {
      // File doesn't exist - nothing to delete
      throw new Error(`Cannot delete non-existent file: ${relativePath}`);
    }

    const edit = this.createPendingEdit({
      path: relativePath,
      operationType: 'delete',
      originalContent,
      newContent: null,
      description: description ?? `Delete ${relativePath}`,
    });

    this.addPendingEdit(edit);
    return edit;
  }

  /**
   * Propose renaming a file
   */
  async proposeRename(
    oldPath: string,
    newPath: string,
    description?: string
  ): Promise<PendingEdit> {
    const absOldPath = this.resolvePath(oldPath);
    
    let content: string | null = null;
    try {
      content = await fs.readFile(absOldPath, 'utf8');
      if (this.options.autoSnapshot) {
        await this.snapshotFile(oldPath);
      }
    } catch {
      throw new Error(`Cannot rename non-existent file: ${oldPath}`);
    }

    const edit = this.createPendingEdit({
      path: newPath,
      operationType: 'rename',
      originalContent: content,
      newContent: content,
      originalPath: oldPath,
      description: description ?? `Rename ${oldPath} → ${newPath}`,
    });

    this.addPendingEdit(edit);
    return edit;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all pending edits, optionally filtered by chat ID
   * @param chatId - If provided, only return edits from this chat. If null, return all.
   */
  getPendingEdits(chatId?: string | null): PendingEdit[] {
    const all = Array.from(this.pendingEdits.values());
    if (chatId === undefined) {
      // No filter specified, return all
      return all;
    }
    // Filter by chatId (null matches edits with no chatId)
    return all.filter(e => e.chatId === chatId);
  }

  /**
   * Get pending edits for the current chat session only
   */
  getPendingEditsForCurrentChat(): PendingEdit[] {
    return this.getPendingEdits(this.currentChatId);
  }

  /**
   * Get a specific pending edit by path
   */
  getPendingEdit(relativePath: string): PendingEdit | undefined {
    return this.pendingEdits.get(relativePath);
  }

  /**
   * Check if there are any pending changes for the current chat
   */
  hasPendingChanges(): boolean {
    return this.getPendingEditsForCurrentChat().length > 0;
  }

  /**
   * Check if there are any pending changes globally (all chats)
   */
  hasPendingChangesGlobal(): boolean {
    return this.pendingEdits.size > 0;
  }

  /**
   * Get the effective content of a file (pending edit or disk)
   */
  async getEffectiveContent(relativePath: string): Promise<string | null> {
    const pending = this.pendingEdits.get(relativePath);
    if (pending) {
      return pending.newContent;
    }
    
    try {
      const absPath = this.resolvePath(relativePath);
      return await fs.readFile(absPath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Get diff for a pending edit
   */
  getDiff(relativePath: string): FileDiff | undefined {
    const edit = this.pendingEdits.get(relativePath);
    if (!edit) return undefined;
    
    // Return cached diff or compute it
    if (!edit.diff) {
      edit.diff = DiffEngine.computeDiff(
        edit.path,
        edit.originalContent,
        edit.newContent
      );
    }
    return edit.diff;
  }

  /**
   * Get summary of pending changes for current chat
   */
  getSummary(): PendingChangesSummary {
    return this.getSummaryForChat(this.currentChatId);
  }

  /**
   * Get summary of pending changes, optionally filtered by chat ID
   */
  getSummaryForChat(chatId?: string | null): PendingChangesSummary {
    let additions = 0;
    let deletions = 0;
    let newFiles = 0;
    let modifiedFiles = 0;
    let deletedFiles = 0;
    let renamedFiles = 0;

    const edits = chatId === undefined 
      ? Array.from(this.pendingEdits.values())
      : this.getPendingEdits(chatId);

    for (const edit of edits) {
      const diff = this.getDiff(edit.path);
      if (diff) {
        additions += diff.additions;
        deletions += diff.deletions;
      }

      switch (edit.operationType) {
        case 'create':
          newFiles++;
          break;
        case 'modify':
          modifiedFiles++;
          break;
        case 'delete':
          deletedFiles++;
          break;
        case 'rename':
        case 'move':
          renamedFiles++;
          break;
      }
    }

    return {
      totalFiles: edits.length,
      additions,
      deletions,
      newFiles,
      modifiedFiles,
      deletedFiles,
      renamedFiles,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMMIT / REJECT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Accept and commit a single pending edit
   */
  async acceptEdit(editId: string): Promise<CommitResult> {
    const edit = this.findEditById(editId);
    if (!edit) {
      return {
        success: false,
        committedPaths: [],
        failedPaths: [{ path: 'unknown', error: `Edit not found: ${editId}` }],
        summary: 'Edit not found',
      };
    }

    return this.commitEdits([edit]);
  }

  /**
   * Accept and commit all pending edits
   */
  async acceptAll(): Promise<CommitResult> {
    const edits = Array.from(this.pendingEdits.values());
    return this.commitEdits(edits);
  }

  /**
   * Reject/Undo a single pending edit.
   * In auto-apply mode, this restores the original state.
   * @param undoFromDisk - If true, restore original file state on disk
   */
  async rejectEdit(editId: string, undoFromDisk: boolean = true): Promise<boolean> {
    const edit = this.findEditById(editId);
    if (!edit) return false;

    if (undoFromDisk) {
      try {
        await this.undoEdit(edit);
      } catch (err) {
        console.error(`Failed to undo edit ${editId}:`, err);
        return false;
      }
    }

    this.pendingEdits.delete(edit.path);
    edit.status = 'rejected';
    
    this.emit({ type: 'edit-rejected', editId, path: edit.path });
    return true;
  }

  /**
   * Reject/Undo all pending edits.
   * In auto-apply mode, this restores all files to their original state.
   * @param undoFromDisk - If true, restore original file states on disk
   */
  async rejectAll(undoFromDisk: boolean = true): Promise<void> {
    if (undoFromDisk) {
      for (const edit of this.pendingEdits.values()) {
        try {
          await this.undoEdit(edit);
        } catch (err) {
          console.error(`Failed to undo edit ${edit.id}:`, err);
        }
      }
    }

    for (const edit of this.pendingEdits.values()) {
      edit.status = 'rejected';
    }
    this.pendingEdits.clear();
    this.emit({ type: 'all-rejected' });
  }

  /**
   * Undo a single edit by restoring original state on disk
   */
  private async undoEdit(edit: PendingEdit): Promise<void> {
    const absPath = this.resolvePath(edit.path);

    switch (edit.operationType) {
      case 'create':
        // File was created - delete it
        try {
          await fs.unlink(absPath);
        } catch {
          // File might already be gone
        }
        break;

      case 'modify':
        // File was modified - restore original content
        if (edit.originalContent !== null) {
          await fs.writeFile(absPath, edit.originalContent, 'utf8');
        } else {
          // Original didn't exist, delete the file
          try {
            await fs.unlink(absPath);
          } catch {
            // File might already be gone
          }
        }
        break;

      case 'delete':
        // File was deleted - recreate with original content
        if (edit.originalContent !== null) {
          await fs.mkdir(path.dirname(absPath), { recursive: true });
          await fs.writeFile(absPath, edit.originalContent, 'utf8');
        }
        break;

      case 'rename':
      case 'move':
        // File was renamed - rename it back
        if (edit.originalPath) {
          const originalAbsPath = this.resolvePath(edit.originalPath);
          await fs.mkdir(path.dirname(originalAbsPath), { recursive: true });
          await fs.rename(absPath, originalAbsPath);
        }
        break;
    }
  }

  /**
   * Clear all pending edits and snapshots
   */
  clear(): void {
    this.pendingEdits.clear();
    this.snapshots.clear();
    this.emit({ type: 'cleared' });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Take a snapshot of a file's current state
   */
  async snapshotFile(relativePath: string): Promise<FileSnapshot> {
    const absPath = this.resolvePath(relativePath);
    
    try {
      const stat = await fs.stat(absPath);
      const content = await fs.readFile(absPath, 'utf8');
      
      const snapshot: FileSnapshot = {
        path: relativePath,
        content,
        exists: true,
        mtime: stat.mtimeMs,
        size: stat.size,
      };
      
      this.snapshots.set(relativePath, snapshot);
      return snapshot;
    } catch {
      const snapshot: FileSnapshot = {
        path: relativePath,
        content: null,
        exists: false,
      };
      this.snapshots.set(relativePath, snapshot);
      return snapshot;
    }
  }

  /**
   * Get a previously taken snapshot
   */
  getSnapshot(relativePath: string): FileSnapshot | undefined {
    return this.snapshots.get(relativePath);
  }

  /**
   * Restore a file to its snapshot state
   */
  async restoreFromSnapshot(relativePath: string): Promise<boolean> {
    const snapshot = this.snapshots.get(relativePath);
    if (!snapshot) return false;

    const absPath = this.resolvePath(relativePath);

    try {
      if (snapshot.exists && snapshot.content !== null) {
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, snapshot.content, 'utf8');
      } else {
        // File didn't exist - try to delete it
        try {
          await fs.unlink(absPath);
        } catch {
          // Ignore if already gone
        }
      }

      // Remove the pending edit for this path
      this.pendingEdits.delete(relativePath);
      return true;
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to shadow workspace events
   */
  onEvent(listener: ShadowWorkspaceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ShadowWorkspaceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Shadow workspace listener error:', err);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private resolvePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/');
    if (path.isAbsolute(normalized)) {
      throw new Error('Absolute paths not allowed in shadow workspace');
    }
    return path.resolve(this.workspacePath, normalized);
  }

  private createPendingEdit(params: {
    path: string;
    operationType: FileOperationType;
    originalContent: string | null;
    newContent: string | null;
    originalPath?: string;
    description?: string;
  }): PendingEdit {
    const id = `edit-${++this.editCounter}-${Date.now()}`;
    
    const edit: PendingEdit = {
      id,
      path: params.path,
      operationType: params.operationType,
      originalContent: params.originalContent,
      newContent: params.newContent,
      originalPath: params.originalPath,
      createdAt: Date.now(),
      description: params.description,
      chatId: this.currentChatId ?? undefined,  // Associate with current chat
      status: 'pending',
    };

    // Compute diff eagerly if configured
    if (this.options.computeDiffsEagerly) {
      edit.diff = DiffEngine.computeDiff(
        params.path,
        params.originalContent,
        params.newContent
      );
    }

    return edit;
  }

  private addPendingEdit(edit: PendingEdit): void {
    // Check limit
    if (this.pendingEdits.size >= this.options.maxPendingEdits) {
      // Remove oldest edit
      const oldest = Array.from(this.pendingEdits.values())
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) {
        this.pendingEdits.delete(oldest.path);
        this.emit({ type: 'edit-removed', editId: oldest.id, path: oldest.path });
      }
    }

    // If there's already an edit for this path, replace it
    const existing = this.pendingEdits.get(edit.path);
    if (existing) {
      this.emit({ type: 'edit-removed', editId: existing.id, path: existing.path });
    }

    this.pendingEdits.set(edit.path, edit);
    this.emit({ type: 'edit-added', edit });
  }

  private findEditById(editId: string): PendingEdit | undefined {
    for (const edit of this.pendingEdits.values()) {
      if (edit.id === editId) return edit;
    }
    return undefined;
  }

  private async commitEdits(edits: PendingEdit[]): Promise<CommitResult> {
    const committedPaths: string[] = [];
    const failedPaths: { path: string; error: string }[] = [];

    for (const edit of edits) {
      try {
        await this.applyEdit(edit);
        edit.status = 'accepted';
        committedPaths.push(edit.path);
        this.pendingEdits.delete(edit.path);
        this.emit({ type: 'edit-accepted', editId: edit.id, path: edit.path });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        failedPaths.push({ path: edit.path, error: errorMsg });
      }
    }

    const allAccepted = failedPaths.length === 0 && edits.length > 0;
    if (allAccepted && edits.length === this.pendingEdits.size + committedPaths.length) {
      this.emit({ type: 'all-accepted' });
    }

    return {
      success: failedPaths.length === 0,
      committedPaths,
      failedPaths,
      summary: this.formatCommitSummary(committedPaths, failedPaths),
    };
  }

  private async applyEdit(edit: PendingEdit): Promise<void> {
    const absPath = this.resolvePath(edit.path);

    switch (edit.operationType) {
      case 'create':
      case 'modify':
        if (edit.newContent === null) {
          throw new Error(`Cannot create/modify file with null content: ${edit.path}`);
        }
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, edit.newContent, 'utf8');
        break;

      case 'delete':
        await fs.unlink(absPath);
        break;

      case 'rename':
      case 'move':
        if (!edit.originalPath) {
          throw new Error(`Missing originalPath for rename/move: ${edit.path}`);
        }
        const oldAbsPath = this.resolvePath(edit.originalPath);
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.rename(oldAbsPath, absPath);
        break;
    }
  }

  private formatCommitSummary(
    committed: string[],
    failed: { path: string; error: string }[]
  ): string {
    const parts: string[] = [];
    
    if (committed.length > 0) {
      parts.push(`✅ ${committed.length} file(s) committed`);
    }
    if (failed.length > 0) {
      parts.push(`❌ ${failed.length} file(s) failed`);
    }
    
    return parts.join(', ') || 'No changes';
  }

  /**
   * Get workspace path
   */
  getWorkspacePath(): string {
    return this.workspacePath;
  }
}

