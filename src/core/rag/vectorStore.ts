// © ASICBOT Private Limited Inc
// Vector Store with Merkle Diff for Efficient Indexing

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { 
  CodeChunk, 
  EmbeddedChunk, 
  FileMetadata, 
  SearchResult, 
  SearchOptions,
  IndexStats 
} from './types';
import { EmbeddingService } from './embeddings';

/**
 * Vector Store
 * 
 * Stores code chunks with embeddings and provides similarity search.
 * Uses Merkle hashing for efficient incremental updates.
 */
export class VectorStore {
  private chunks: Map<string, EmbeddedChunk> = new Map();
  private fileIndex: Map<string, FileMetadata> = new Map();
  private embeddingService: EmbeddingService;
  private indexPath: string;
  private isDirty = false;

  constructor(indexPath: string, embeddingService?: EmbeddingService) {
    this.indexPath = indexPath;
    this.embeddingService = embeddingService || new EmbeddingService();
  }

  /**
   * Initialize the vector store
   */
  async initialize(): Promise<void> {
    await this.embeddingService.initialize();
    await this.loadIndex();
  }

  /**
   * Index a file (with Merkle diff for efficiency)
   */
  async indexFile(filePath: string, content: string, chunks: CodeChunk[]): Promise<boolean> {
    const fileHash = this.hash(content);
    const existingFile = this.fileIndex.get(filePath);

    // Merkle diff: skip if file hash unchanged
    if (existingFile && existingFile.fileHash === fileHash) {
      return false; // No changes
    }

    // Remove old chunks for this file
    if (existingFile) {
      for (const chunkId of existingFile.chunkIds) {
        this.chunks.delete(chunkId);
      }
    }

    // Index new chunks
    const chunkIds: string[] = [];
    
    for (const chunk of chunks) {
      // Check if chunk content already exists (Merkle diff)
      const existingChunk = this.findChunkByHash(chunk.contentHash);
      
      if (existingChunk) {
        // Reuse existing embedding
        chunkIds.push(existingChunk.id);
      } else {
        // Generate new embedding
        const embedding = await this.embeddingService.embed(chunk.content);
        const embeddedChunk: EmbeddedChunk = {
          ...chunk,
          embedding,
          embeddedAt: Date.now(),
        };
        this.chunks.set(chunk.id, embeddedChunk);
        chunkIds.push(chunk.id);
      }
    }

    // Update file metadata
    const stat = { mtime: Date.now(), size: content.length };
    this.fileIndex.set(filePath, {
      path: filePath,
      fileHash,
      mtime: stat.mtime,
      size: stat.size,
      chunkIds,
      indexedAt: Date.now(),
    });

    this.isDirty = true;
    return true;
  }

  /**
   * Remove a file from the index
   */
  removeFile(filePath: string): boolean {
    const file = this.fileIndex.get(filePath);
    if (!file) return false;

    for (const chunkId of file.chunkIds) {
      this.chunks.delete(chunkId);
    }
    this.fileIndex.delete(filePath);
    this.isDirty = true;
    return true;
  }

  /**
   * Search for similar chunks
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const opts: Required<SearchOptions> = {
      topK: options?.topK ?? 10,
      minScore: options?.minScore ?? 0.1,
      pathPrefix: options?.pathPrefix ?? '',
      chunkTypes: options?.chunkTypes ?? [],
      language: options?.language ?? '',
    };

    // Embed the query
    const queryEmbedding = await this.embeddingService.embed(query);

    // Score all chunks
    const results: SearchResult[] = [];

    for (const chunk of this.chunks.values()) {
      // Apply filters
      if (opts.pathPrefix && !chunk.filePath.startsWith(opts.pathPrefix)) continue;
      if (opts.chunkTypes.length > 0 && !opts.chunkTypes.includes(chunk.chunkType)) continue;
      if (opts.language && chunk.language !== opts.language) continue;

      // Compute similarity
      const score = EmbeddingService.cosineSimilarity(queryEmbedding, chunk.embedding);
      
      if (score >= opts.minScore) {
        results.push({
          chunk,
          score,
          highlight: this.extractHighlight(chunk.content, query),
        });
      }
    }

    // Sort by score and return top K
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.topK);
  }

  /**
   * Build vocabulary from all indexed content
   */
  buildVocabulary(): void {
    const documents = Array.from(this.chunks.values()).map(c => c.content);
    this.embeddingService.buildVocabulary(documents);
  }

  /**
   * Re-embed all chunks (after vocabulary update)
   */
  async reembedAll(): Promise<void> {
    const chunks = Array.from(this.chunks.values());
    const contents = chunks.map(c => c.content);
    const embeddings = await this.embeddingService.embedBatch(contents);

    for (let i = 0; i < chunks.length; i++) {
      chunks[i].embedding = embeddings[i];
      chunks[i].embeddedAt = Date.now();
    }

    this.isDirty = true;
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    return {
      totalFiles: this.fileIndex.size,
      totalChunks: this.chunks.size,
      totalEmbeddings: Array.from(this.chunks.values()).filter(c => c.embedding.length > 0).length,
      lastUpdated: Math.max(...Array.from(this.fileIndex.values()).map(f => f.indexedAt), 0),
      indexSize: this.estimateSize(),
    };
  }

  /**
   * Check if a file needs re-indexing
   */
  needsReindex(filePath: string, content: string): boolean {
    const fileHash = this.hash(content);
    const existingFile = this.fileIndex.get(filePath);
    return !existingFile || existingFile.fileHash !== fileHash;
  }

  /**
   * Get all indexed file paths
   */
  getIndexedFiles(): string[] {
    return Array.from(this.fileIndex.keys());
  }

  /**
   * Get chunks for a file
   */
  getFileChunks(filePath: string): EmbeddedChunk[] {
    const file = this.fileIndex.get(filePath);
    if (!file) return [];
    return file.chunkIds.map(id => this.chunks.get(id)).filter(Boolean) as EmbeddedChunk[];
  }

  /**
   * Save index to disk
   */
  async saveIndex(): Promise<void> {
    if (!this.isDirty) return;

    const data = {
      version: 1,
      chunks: Array.from(this.chunks.entries()),
      fileIndex: Array.from(this.fileIndex.entries()),
    };

    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.writeFile(this.indexPath, JSON.stringify(data));
    this.isDirty = false;
  }

  /**
   * Load index from disk
   */
  async loadIndex(): Promise<void> {
    try {
      const content = await fs.readFile(this.indexPath, 'utf8');
      const data = JSON.parse(content);
      
      if (data.version === 1) {
        this.chunks = new Map(data.chunks);
        this.fileIndex = new Map(data.fileIndex);
      }
    } catch {
      // Index doesn't exist or is corrupted, start fresh
      this.chunks.clear();
      this.fileIndex.clear();
    }
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.chunks.clear();
    this.fileIndex.clear();
    this.isDirty = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private findChunkByHash(contentHash: string): EmbeddedChunk | undefined {
    for (const chunk of this.chunks.values()) {
      if (chunk.contentHash === contentHash) return chunk;
    }
    return undefined;
  }

  private extractHighlight(content: string, query: string): string {
    const lines = content.split('\n');
    const queryTerms = query.toLowerCase().split(/\s+/);
    
    // Find the most relevant line
    let bestLine = '';
    let bestScore = 0;
    
    for (const line of lines) {
      const lineLower = line.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (lineLower.includes(term)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestLine = line;
      }
    }
    
    return bestLine.trim().substring(0, 200);
  }

  private hash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  private estimateSize(): number {
    let size = 0;
    for (const chunk of this.chunks.values()) {
      size += chunk.content.length;
      size += chunk.embedding.length * 8; // 8 bytes per float64
    }
    return size;
  }
}

