// © ASICBOT Private Limited Inc
// Shadow Workspace Type Definitions

/**
 * Represents the type of file operation
 */
export type FileOperationType = 
  | 'create'      // New file created
  | 'modify'      // Existing file modified
  | 'delete'      // File deleted
  | 'rename'      // File renamed
  | 'move';       // File moved to different location

/**
 * Represents a single line in a diff
 */
export interface DiffLine {
  type: 'add' | 'remove' | 'unchanged' | 'header';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/**
 * Represents a hunk (continuous block of changes) in a diff
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/**
 * Complete diff result for a file
 */
export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isBinary: boolean;
  isNewFile: boolean;
  isDeleted: boolean;
}

/**
 * Snapshot of a file's original state
 */
export interface FileSnapshot {
  path: string;                // Relative path from workspace root
  content: string | null;      // Original content (null if file didn't exist)
  exists: boolean;             // Whether file existed before
  mtime?: number;              // Modification time when snapshot was taken
  size?: number;               // Original file size
}

/**
 * A pending edit that hasn't been committed to disk
 */
export interface PendingEdit {
  id: string;                  // Unique identifier for this edit
  path: string;                // Relative path from workspace root
  operationType: FileOperationType;
  
  // Content
  originalContent: string | null;   // Content before edit (null if new file)
  newContent: string | null;        // Content after edit (null if deleted)
  
  // For rename/move operations
  originalPath?: string;       // Original path (for rename/move)
  
  // Metadata
  createdAt: number;           // When this edit was proposed
  description?: string;        // Human-readable description of the change
  chatId?: string;             // ID of the chat session that created this edit
  
  // Status
  status: 'pending' | 'accepted' | 'rejected';
  
  // Computed diff (cached)
  diff?: FileDiff;
}

/**
 * Summary of all pending changes
 */
export interface PendingChangesSummary {
  totalFiles: number;
  additions: number;           // Total lines added
  deletions: number;           // Total lines removed
  newFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
  renamedFiles: number;
}

/**
 * Events emitted by the Shadow Workspace
 */
export type ShadowWorkspaceEvent = 
  | { type: 'edit-added'; edit: PendingEdit }
  | { type: 'edit-removed'; editId: string; path: string }
  | { type: 'edit-accepted'; editId: string; path: string }
  | { type: 'edit-rejected'; editId: string; path: string }
  | { type: 'all-accepted' }
  | { type: 'all-rejected' }
  | { type: 'cleared' };

/**
 * Listener function for shadow workspace events
 */
export type ShadowWorkspaceListener = (event: ShadowWorkspaceEvent) => void;

/**
 * Options for the Shadow Workspace
 */
export interface ShadowWorkspaceOptions {
  /** Maximum number of pending edits to keep */
  maxPendingEdits?: number;
  
  /** Whether to auto-snapshot files before editing */
  autoSnapshot?: boolean;
  
  /** Whether to compute diffs eagerly or lazily */
  computeDiffsEagerly?: boolean;
}

/**
 * Result of committing changes
 */
export interface CommitResult {
  success: boolean;
  committedPaths: string[];
  failedPaths: { path: string; error: string }[];
  summary: string;
}

/**
 * Options for viewing a file in the shadow workspace
 */
export interface ShadowViewOptions {
  showDiff?: boolean;          // Show side-by-side diff
  previewOnly?: boolean;       // Don't allow editing
  highlightChanges?: boolean;  // Highlight changed lines
}

