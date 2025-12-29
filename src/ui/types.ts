// Webview <-> Extension contracts (TypeScript)

// Webview -> Extension
export type WebviewOutbound =
  | { type: 'UPLOAD/FILE'; name: string; mime: string; dataBase64: string; sessionId: string }
  | { type: 'CHAT/CLEAR_SESSION'; sessionId: string }
  | { type: 'CHAT/SWITCH_SESSION'; sessionId: string }  // Notify extension when chat changes
  | { type: 'UI/READY' }
  | { type: 'CHAT/SEND_PROMPT'; prompt: string; contextBlobs: string[]; sessionId: string; titleHint: string }
  | { type: 'CHAT/STOP'; runId: string }
  | { type: 'HISTORY/NEW_SESSION' }
  | { type: 'HISTORY/RENAME'; sessionId: string; title: string }
  | { type: 'HISTORY/DELETE_SESSION'; sessionId: string }
  | { type: 'MENTION/QUERY'; q: string }
  | { type: 'MENTION/LIST_DIR'; path: string }
  | { type: 'MENTION/READ_FILE'; path: string }
  // Shadow Workspace messages
  | { type: 'SHADOW/GET_PENDING' }
  | { type: 'SHADOW/ACCEPT_EDIT'; editId: string }
  | { type: 'SHADOW/ACCEPT_ALL' }
  | { type: 'SHADOW/REJECT_EDIT'; editId: string }
  | { type: 'SHADOW/REJECT_ALL' }
  | { type: 'SHADOW/GET_DIFF'; path: string };

// Extension -> Webview
export type ExtensionInbound =
  | { type: 'HISTORY/LOAD_OK'; history: Session[]; focus?: string }
  | { type: 'CHAT/STREAM_START'; runId: string; sessionId: string }
  | { type: 'CHAT/STREAM_DELTA'; runId: string; text: string }
  | { type: 'TRACE/ENTRY'; runId: string; entry: unknown }
  | { type: 'TOOL/EVENT'; runId: string; evt: unknown }
  | { type: 'CHAT/STREAM_END'; runId: string; ok?: boolean; stopped?: boolean }
  | { type: 'CHAT/ERROR'; runId?: string; message: string }
  | { type: 'MENTION/RESULTS'; items: MentionItem[] }
  | { type: 'MENTION/DIR_CONTENTS'; base: string; items: MentionItem[] }
  | { type: 'MENTION/FILE_CONTENT'; path: string; content: string; mime?: string }
  | { type: 'UPLOAD/START'; fileName: string; sessionId: string }
  | { type: 'UPLOAD/SUCCESS'; fileName: string; sessionId: string }
  | { type: 'UPLOAD/ERROR'; fileName: string; sessionId: string; message: string }
  // Shadow Workspace responses
  | { type: 'SHADOW/PENDING_CHANGES'; edits: PendingEditUI[]; summary: PendingChangesSummaryUI | null }
  | { type: 'SHADOW/ACCEPT_RESULT'; editId: string; success: boolean; committedPaths: string[]; failedPaths: { path: string; error: string }[]; summary: string }
  | { type: 'SHADOW/ACCEPT_ALL_RESULT'; success: boolean; committedPaths: string[]; failedPaths: { path: string; error: string }[]; summary: string }
  | { type: 'SHADOW/REJECT_RESULT'; editId: string; success: boolean }
  | { type: 'SHADOW/REJECT_ALL_RESULT'; success: boolean }
  | { type: 'SHADOW/DIFF'; path: string; diff: string | null; editId: string | null; operationType: string | null };

// Shadow Workspace Types (UI representation)
export interface PendingEditUI {
  id: string;
  path: string;
  operationType: 'create' | 'modify' | 'delete' | 'rename' | 'move';
  additions: number;
  deletions: number;
  isNewFile: boolean;
  isDeleted: boolean;
  description?: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface PendingChangesSummaryUI {
  totalFiles: number;
  additions: number;
  deletions: number;
  newFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
}

export interface Turn { q: string; r: string; trace?: unknown[]; at: number }
export interface Session { id: string; title: string; turns: Turn[]; createdAt: number }
export type MentionItem = { path: string; name: string; kind: 'file' | 'dir' };
