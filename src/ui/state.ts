// src/ui/state.ts
import type { Session, MentionItem } from './types';

export interface UIState {
  sessions: Session[];
  currentId: string;
  generating: boolean;
  runId: string;
  draft: string;
  mentionOpen: boolean;
  mentionItems: MentionItem[];
  contextBlobs: string[]; // one-shot context from @mentions
  liveText: string;       // streaming text
  liveTrace: string[];    // streaming trace lines
  historyOpen: boolean;
  ingestion?: {
    status: 'hidden' | 'ingesting' | 'done' | 'error';
    fileName?: string;
    queriesSince: number;   // for auto-hide rule
    lastAt?: number;
  };
}

export const state: UIState = {
  sessions: [],
  currentId: '',
  generating: false,
  runId: '',
  draft: '',
  mentionOpen: false,
  mentionItems: [],
  contextBlobs: [],
  liveText: '',
  liveTrace: [],
  historyOpen: false,
  ingestion: { status: 'hidden', queriesSince: 0 }
};

export const current = () => state.sessions.find(s => s.id === state.currentId);

export function stringify(x: unknown): string {
  if (typeof x === 'string') return x;
  try { return JSON.stringify(x, null, 2); } catch { return String(x); }
}

/** Resets just the transient/streaming fields (optional helper) */
export function resetTransient(): void {
  state.generating = false;
  state.runId = '';
  state.draft = '';
  state.liveText = '';
  state.liveTrace = [];
}
