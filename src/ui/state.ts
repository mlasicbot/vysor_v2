// src/ui/state.ts
import type { Session, MentionItem } from './types';
import type { VysorMode } from './components/ModeSelector';

/**
 * Pending edit from Shadow Workspace (UI representation)
 */
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

/**
 * Summary of pending changes from Shadow Workspace
 */
export interface PendingChangesSummaryUI {
  totalFiles: number;
  additions: number;
  deletions: number;
  newFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
}

/**
 * Response phase for visual tracking
 */
export type ResponsePhaseType = 'thinking' | 'executing' | 'reasoning' | 'final';

export interface ResponsePhaseItem {
  phase: ResponsePhaseType;
  label: string;
  content?: string;
  toolName?: string;
  isActive?: boolean;
  isComplete?: boolean;
}

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
  
  // Mode system
  currentMode: VysorMode;
  
  // Response phases
  currentPhase: ResponsePhaseType;
  responsePhases: ResponsePhaseItem[];
  
  // File browser for @-mentions
  fileBrowserOpen: boolean;
  fileBrowserPath: string;
  fileBrowserQuery: string;
  
  // Shadow Workspace state
  pendingEdits: PendingEditUI[];
  pendingChangesSummary: PendingChangesSummaryUI | null;
  diffViewerOpen: boolean;
  diffViewerPath: string | null;
  diffViewerContent: string | null;
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
  ingestion: { status: 'hidden', queriesSince: 0 },
  
  // Mode system
  currentMode: 'agent',
  
  // Response phases
  currentPhase: 'thinking',
  responsePhases: [],
  
  // File browser
  fileBrowserOpen: false,
  fileBrowserPath: '.',
  fileBrowserQuery: '',
  
  // Shadow Workspace initial state
  pendingEdits: [],
  pendingChangesSummary: null,
  diffViewerOpen: false,
  diffViewerPath: null,
  diffViewerContent: null,
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
