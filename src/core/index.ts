// © ASICBOT Private Limited Inc
// Core module exports - Orchestrator, Shadow Workspace, Tools, RAG

// Orchestrator - main agent coordination
export {
  Orchestrator,
  type OrchestratorConfig,
  type QueryRequest,
  type ProgressCallback,
  type ResponsePhase,
  type ProgressEvent,
} from './orchestrator';

// Shadow Workspace - speculative file editing with preview
export {
  ShadowFileTools,
  type ShadowFileToolsConfig,
} from './shadow';

export type {
  PendingEdit,
  PendingChangesSummary,
  CommitResult,
  FileDiff,
} from './shadow/types';

// Legacy file tools (non-shadow)
export { FileOperationTools, type FileToolsOptions } from './tools';

// RAG - Retrieval Augmented Generation for codebase search
export { RAGIndex } from './rag';
export type { IndexStats, SearchOptions, SearchResult, CodeChunk } from './rag/types';

// Planner client
export { PlannerClient } from './planner/plannerClient';

