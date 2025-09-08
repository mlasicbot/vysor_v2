// Webview <-> Extension contracts (TypeScript)

// Webview -> Extension
export type WebviewOutbound =
  | { type: 'UPLOAD/FILE'; name: string; mime: string; dataBase64: string; sessionId: string }
  | { type: 'CHAT/CLEAR_SESSION'; sessionId: string }
  | { type: 'UI/READY' }
  | { type: 'CHAT/SEND_PROMPT'; prompt: string; contextBlobs: string[]; sessionId: string; titleHint: string }
  | { type: 'CHAT/STOP'; runId: string }
  | { type: 'HISTORY/NEW_SESSION' }
  | { type: 'HISTORY/RENAME'; sessionId: string; title: string }
  | { type: 'HISTORY/DELETE_SESSION'; sessionId: string }
  | { type: 'MENTION/QUERY'; q: string }
  | { type: 'MENTION/LIST_DIR'; path: string }
  | { type: 'MENTION/READ_FILE'; path: string };

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
  | { type: 'UPLOAD/ERROR'; fileName: string; sessionId: string; message: string };

export interface Turn { q: string; r: string; trace?: unknown[]; at: number }
export interface Session { id: string; title: string; turns: Turn[]; createdAt: number }
export type MentionItem = { path: string; name: string; kind: 'file' | 'dir' };
