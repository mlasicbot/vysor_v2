// © ASICBOT Private Limited Inc
// RAG Index Manager - Coordinates chunking, embedding, and search

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CodeChunker } from './chunker';
import { VectorStore } from './vectorStore';
import { EmbeddingService } from './embeddings';
import type { SearchResult, SearchOptions, IndexStats, CodeChunk } from './types';

/**
 * RAG Index Manager
 * 
 * Manages the semantic search index for a workspace:
 * - Watches for file changes
 * - Incrementally updates the index
 * - Provides search interface
 */
export class RAGIndex {
  private static instance: RAGIndex | null = null;
  
  private workspacePath: string;
  private chunker: CodeChunker;
  private vectorStore: VectorStore;
  private embeddingService: EmbeddingService;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private isIndexing = false;
  private indexQueue: Set<string> = new Set();
  private initialized = false;

  // File patterns to index
  private readonly includePatterns = [
    '**/*.sv', '**/*.svh', '**/*.v', '**/*.vh',  // SystemVerilog/Verilog
    '**/*.py',                                     // Python
    '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', // TypeScript/JavaScript
    '**/*.vhd', '**/*.vhdl',                       // VHDL
  ];

  // Directories to exclude
  private readonly excludeDirs = [
    'node_modules', '.git', '.venv', '__pycache__', 
    'dist', 'out', 'build', '.cache', 'coverage',
    'venv', 'env', '.env', '.tox', '.pytest_cache',
  ];

  private constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.chunker = new CodeChunker();
    this.embeddingService = new EmbeddingService();
    
    const indexPath = path.join(workspacePath, '.vysor', 'rag-index.json');
    this.vectorStore = new VectorStore(indexPath, this.embeddingService);
  }

  /**
   * Get or create the singleton instance
   */
  static getInstance(workspacePath?: string): RAGIndex {
    if (!RAGIndex.instance) {
      const wsPath = workspacePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsPath) {
        throw new Error('No workspace folder available');
      }
      RAGIndex.instance = new RAGIndex(wsPath);
    }
    return RAGIndex.instance;
  }

  /**
   * Reset the singleton
   */
  static reset(): void {
    if (RAGIndex.instance) {
      RAGIndex.instance.dispose();
      RAGIndex.instance = null;
    }
  }

  /**
   * Initialize the index
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.vectorStore.initialize();
    this.setupFileWatcher();
    this.initialized = true;
  }

  /**
   * Build or update the full index
   */
  async buildIndex(onProgress?: (message: string, percent: number) => void): Promise<IndexStats> {
    if (this.isIndexing) {
      throw new Error('Indexing already in progress');
    }

    this.isIndexing = true;
    
    try {
      onProgress?.('Finding files...', 0);
      
      // Find all files to index
      const files = await this.findFiles();
      const total = files.length;
      let indexed = 0;
      let updated = 0;

      onProgress?.(`Found ${total} files`, 5);

      // First pass: collect all content for vocabulary building
      const allChunks: CodeChunk[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const relativePath = path.relative(this.workspacePath, filePath).replace(/\\/g, '/');
        
        try {
          const content = await fs.readFile(filePath, 'utf8');
          
          // Skip if unchanged
          if (!this.vectorStore.needsReindex(relativePath, content)) {
            indexed++;
            continue;
          }

          const chunks = this.chunker.chunkFile(relativePath, content);
          allChunks.push(...chunks);
          
          // Index the file
          const wasUpdated = await this.vectorStore.indexFile(relativePath, content, chunks);
          if (wasUpdated) updated++;
          indexed++;
          
          const percent = Math.round((indexed / total) * 90) + 5;
          onProgress?.(`Indexing: ${relativePath}`, percent);
        } catch (err) {
          console.error(`Failed to index ${filePath}:`, err);
        }
      }

      // Build vocabulary and re-embed if we have enough content
      if (allChunks.length > 10) {
        onProgress?.('Building vocabulary...', 95);
        this.vectorStore.buildVocabulary();
        await this.vectorStore.reembedAll();
      }

      // Save index
      onProgress?.('Saving index...', 98);
      await this.vectorStore.saveIndex();

      onProgress?.('Done!', 100);
      return this.vectorStore.getStats();
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Search the index
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.vectorStore.search(query, options);
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    return this.vectorStore.getStats();
  }

  /**
   * Check if index exists and is populated
   */
  isIndexed(): boolean {
    return this.vectorStore.getStats().totalChunks > 0;
  }

  /**
   * Index a single file
   */
  async indexFile(filePath: string): Promise<boolean> {
    const relativePath = path.relative(this.workspacePath, filePath).replace(/\\/g, '/');
    
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const chunks = this.chunker.chunkFile(relativePath, content);
      const updated = await this.vectorStore.indexFile(relativePath, content, chunks);
      
      if (updated) {
        await this.vectorStore.saveIndex();
      }
      
      return updated;
    } catch (err) {
      console.error(`Failed to index ${filePath}:`, err);
      return false;
    }
  }

  /**
   * Remove a file from the index
   */
  async removeFile(filePath: string): Promise<boolean> {
    const relativePath = path.relative(this.workspacePath, filePath).replace(/\\/g, '/');
    const removed = this.vectorStore.removeFile(relativePath);
    
    if (removed) {
      await this.vectorStore.saveIndex();
    }
    
    return removed;
  }

  /**
   * Clear the entire index
   */
  async clearIndex(): Promise<void> {
    this.vectorStore.clear();
    await this.vectorStore.saveIndex();
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async findFiles(): Promise<string[]> {
    const files: string[] = [];
    
    for (const pattern of this.includePatterns) {
      const excludePattern = `{${this.excludeDirs.map(d => `**/${d}/**`).join(',')}}`;
      const uris = await vscode.workspace.findFiles(pattern, excludePattern, 5000);
      files.push(...uris.map(u => u.fsPath));
    }
    
    // Deduplicate
    return [...new Set(files)];
  }

  private setupFileWatcher(): void {
    // Watch for file changes
    const pattern = new vscode.RelativePattern(
      this.workspacePath,
      `**/*.{sv,svh,v,vh,py,ts,tsx,js,jsx,vhd,vhdl}`
    );

    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    // Debounced indexing
    const debounceMs = 2000;
    let debounceTimer: NodeJS.Timeout | null = null;

    const queueIndex = (filePath: string) => {
      this.indexQueue.add(filePath);
      
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      
      debounceTimer = setTimeout(async () => {
        const files = [...this.indexQueue];
        this.indexQueue.clear();
        
        for (const file of files) {
          await this.indexFile(file);
        }
      }, debounceMs);
    };

    this.fileWatcher.onDidCreate(uri => queueIndex(uri.fsPath));
    this.fileWatcher.onDidChange(uri => queueIndex(uri.fsPath));
    this.fileWatcher.onDidDelete(uri => this.removeFile(uri.fsPath));
  }
}

// Export all types and classes
export * from './types';
export { CodeChunker } from './chunker';
export { EmbeddingService } from './embeddings';
export { VectorStore } from './vectorStore';

