// src/types/common.ts
// © ASICBOT Private Limited Inc
// Common/shared type definitions for Vysor (extension-side safe)

// Basic roles used across turns
export type Role = 'user' | 'assistant';

// A single Q/A exchange with optional trace info
export interface Turn {
  q: string;            // user question
  r: string;            // assistant reply (final text)
  trace?: unknown[];    // optional planner/tool trace entries
  at: number;           // unix epoch ms
}

// A saved chat session
export interface Session {
  id: string;
  title: string;
  turns: Turn[];
  createdAt: number;

  /**
   * Sticky context: persistent snippets (e.g., OCR markdown, key files)
   * that should be appended to the context for subsequent prompts.
   */
  stickyContext?: string[];
}

// File/directory mention item for @-mentions
export type MentionItem = {
  path: string;               // absolute or workspace path
  name: string;               // display name
  kind: 'file' | 'dir';
};

// ---- File upload / ingestion status (for OCR pipeline) ----

export type UploadPhase = 'idle' | 'uploading' | 'success' | 'error';

export interface UploadStatus {
  fileName: string;
  phase: UploadPhase;
  message?: string;           // error or informational message
}

// ---- Type guards & small helpers ----

export function isTurn(x: unknown): x is Turn {
  const t = x as Turn;
  return !!t && typeof t.q === 'string' && typeof t.r === 'string' && typeof t.at === 'number';
}

export function isSession(x: unknown): x is Session {
  const s = x as Session;
  return !!s && typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    Array.isArray(s.turns) &&
    typeof s.createdAt === 'number';
}

export function nowMs(): number {
  return Date.now();
}
