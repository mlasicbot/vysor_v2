// © ASICBOT Private Limited Inc
// RAG System Type Definitions

/**
 * Types of code chunks recognized by the AST-aware chunker
 */
export type ChunkType =
  | 'module'        // Verilog/SV module
  | 'class'         // SV class, Python/TS class
  | 'function'      // Function/task/method
  | 'interface'     // SV interface, TS interface
  | 'package'       // SV package
  | 'always'        // Always/always_ff/always_comb block
  | 'initial'       // Initial block
  | 'generate'      // Generate block
  | 'typedef'       // Type definitions
  | 'enum'          // Enum declarations
  | 'struct'        // Struct definitions
  | 'constraint'    // SV constraints
  | 'covergroup'    // Coverage groups
  | 'sequence'      // SV sequences
  | 'property'      // SV properties
  | 'import'        // Import/include section
  | 'macro'         // Preprocessor macros
  | 'comment_block' // Documentation blocks
  | 'top_level';    // Fallback for unstructured code

/**
 * A semantic chunk of code extracted from a file
 */
export interface CodeChunk {
  /** Unique identifier (hash of content + path + lines) */
  id: string;
  
  /** Relative file path from workspace root */
  filePath: string;
  
  /** Starting line number (1-indexed) */
  startLine: number;
  
  /** Ending line number (1-indexed) */
  endLine: number;
  
  /** The actual code content */
  content: string;
  
  /** Type of AST node this chunk represents */
  chunkType: ChunkType;
  
  /** Signature/declaration line (e.g., "class axi_driver extends uvm_driver") */
  signature?: string;
  
  /** Name of the entity (e.g., "axi_driver") */
  name?: string;
  
  /** Parent chunk ID for nested structures */
  parentId?: string;
  
  /** Language of the file */
  language: string;
  
  /** SHA256 hash of content for change detection */
  contentHash: string;
}

/**
 * A chunk with its embedding vector
 */
export interface EmbeddedChunk extends CodeChunk {
  /** Embedding vector */
  embedding: number[];
  
  /** Timestamp when embedding was computed */
  embeddedAt: number;
}

/**
 * Search result with relevance score
 */
export interface SearchResult {
  /** The matched chunk */
  chunk: CodeChunk;
  
  /** Similarity score (0-1, higher is better) */
  score: number;
  
  /** Highlighted/relevant portion of content */
  highlight?: string;
}

/**
 * File metadata for Merkle diff
 */
export interface FileMetadata {
  /** Relative file path */
  path: string;
  
  /** SHA256 hash of entire file content */
  fileHash: string;
  
  /** Last modification time */
  mtime: number;
  
  /** File size in bytes */
  size: number;
  
  /** Chunk IDs belonging to this file */
  chunkIds: string[];
  
  /** Last indexed timestamp */
  indexedAt: number;
}

/**
 * Index statistics
 */
export interface IndexStats {
  totalFiles: number;
  totalChunks: number;
  totalEmbeddings: number;
  lastUpdated: number;
  indexSize: number; // bytes
}

/**
 * Options for the chunker
 */
export interface ChunkerOptions {
  /** Maximum chunk size in characters */
  maxChunkSize?: number;
  
  /** Minimum chunk size (smaller chunks are merged) */
  minChunkSize?: number;
  
  /** Include surrounding context lines */
  contextLines?: number;
  
  /** Languages to process */
  supportedLanguages?: string[];
}

/**
 * Options for semantic search
 */
export interface SearchOptions {
  /** Maximum number of results */
  topK?: number;
  
  /** Minimum similarity threshold (0-1) */
  minScore?: number;
  
  /** Filter by file path prefix */
  pathPrefix?: string;
  
  /** Filter by chunk types */
  chunkTypes?: ChunkType[];
  
  /** Filter by language */
  language?: string;
}

/**
 * Embedding model configuration
 */
export interface EmbeddingConfig {
  /** Model type: 'local' | 'openai' | 'voyage' */
  type: 'local' | 'openai' | 'voyage';
  
  /** Model name/identifier */
  modelName: string;
  
  /** Embedding dimension */
  dimension: number;
  
  /** API key (for remote models) */
  apiKey?: string;
  
  /** API endpoint (for remote models) */
  endpoint?: string;
  
  /** Batch size for embedding requests */
  batchSize?: number;
}

