// © ASICBOT Private Limited Inc
// Embedding Service for RAG - Uses all-MiniLM-L6-v2 via ONNX

import type { EmbeddingConfig } from './types';

// Dynamic import for transformers.js (ONNX-based)
let pipeline: any = null;
let embedder: any = null;

/**
 * Default embedding config using all-MiniLM-L6-v2
 */
const DEFAULT_CONFIG: EmbeddingConfig = {
  type: 'local',
  modelName: 'Xenova/all-MiniLM-L6-v2',
  dimension: 384,  // all-MiniLM-L6-v2 produces 384-dim vectors
  batchSize: 32,
};

/**
 * Embedding Service
 * 
 * Generates embeddings for code chunks using all-MiniLM-L6-v2.
 * Uses @xenova/transformers for local ONNX inference.
 */
export class EmbeddingService {
  private config: EmbeddingConfig;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  
  // Fallback TF-IDF for when model not loaded
  private vocabulary: Map<string, number> = new Map();
  private idfScores: Map<string, number> = new Map();
  private documentCount = 0;
  private useFallback = false;

  constructor(config?: Partial<EmbeddingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the embedding service (loads model)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = this.loadModel();
    await this.initPromise;
  }

  private async loadModel(): Promise<void> {
    try {
      console.log('[Embeddings] Loading all-MiniLM-L6-v2 model...');
      
      // Dynamic import to avoid issues if package not installed
      const transformers = await import('@xenova/transformers');
      pipeline = transformers.pipeline;
      
      // Create feature extraction pipeline
      embedder = await pipeline('feature-extraction', this.config.modelName, {
        quantized: true,  // Use quantized model for faster inference
      });
      
      console.log('[Embeddings] Model loaded successfully');
      this.isInitialized = true;
      this.useFallback = false;
    } catch (err) {
      console.warn('[Embeddings] Failed to load model, using TF-IDF fallback:', err);
      this.useFallback = true;
      this.isInitialized = true;
    }
  }

  /**
   * Build vocabulary from a corpus (for TF-IDF fallback)
   */
  buildVocabulary(documents: string[]): void {
    if (!this.useFallback) return; // Not needed for neural embeddings
    
    this.vocabulary.clear();
    this.idfScores.clear();
    this.documentCount = documents.length;

    const docFreq = new Map<string, number>();
    
    for (const doc of documents) {
      const tokens = this.tokenize(doc);
      const uniqueTokens = new Set(tokens);
      
      for (const token of uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }

    const sortedTerms = Array.from(docFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.config.dimension);

    let idx = 0;
    for (const [term, df] of sortedTerms) {
      this.vocabulary.set(term, idx++);
      this.idfScores.set(term, Math.log(this.documentCount / df));
    }
  }

  /**
   * Embed a single text
   */
  async embed(text: string): Promise<number[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.useFallback || !embedder) {
      return this.embedTFIDF(text);
    }

    return this.embedNeural(text);
  }

  /**
   * Embed multiple texts in batch
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.useFallback || !embedder) {
      return texts.map(t => this.embedTFIDF(t));
    }

    // Process in batches
    const results: number[][] = [];
    const batchSize = this.config.batchSize || 32;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(t => this.embedNeural(t)));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Neural embedding using all-MiniLM
   */
  private async embedNeural(text: string): Promise<number[]> {
    try {
      // Truncate long texts (model has 256 token limit)
      const truncated = text.slice(0, 2000);
      
      // Get embeddings
      const output = await embedder(truncated, { 
        pooling: 'mean',    // Mean pooling
        normalize: true     // L2 normalize
      });
      
      // Extract the embedding array
      const embedding = Array.from(output.data as Float32Array);
      return embedding;
    } catch (err) {
      console.warn('[Embeddings] Neural embedding failed, using fallback:', err);
      return this.embedTFIDF(text);
    }
  }

  /**
   * TF-IDF embedding (fallback)
   */
  private embedTFIDF(text: string): number[] {
    const tokens = this.tokenize(text);
    const vector = new Array(this.config.dimension).fill(0);
    
    if (this.vocabulary.size === 0) {
      return this.hashEmbed(text);
    }

    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    for (const [term, count] of tf) {
      const idx = this.vocabulary.get(term);
      if (idx !== undefined) {
        const idf = this.idfScores.get(term) || 1;
        vector[idx] = (count / tokens.length) * idf;
      }
    }

    return this.normalize(vector);
  }

  /**
   * Hash-based embedding (when no vocabulary)
   */
  private hashEmbed(text: string): number[] {
    const tokens = this.tokenize(text);
    const vector = new Array(this.config.dimension).fill(0);
    
    for (const token of tokens) {
      let hash = 0;
      for (let i = 0; i < token.length; i++) {
        hash = ((hash << 5) - hash) + token.charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % this.config.dimension;
      vector[idx] += 1;
    }

    return this.normalize(vector);
  }

  /**
   * Tokenize text into terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s\(\)\[\]\{\}\;\,\:\.\!\?\@\#\$\%\^\&\*\+\=\|\\\/\<\>\`\"\']/)
      .flatMap(token => {
        const snakeParts = token.split('_').filter(Boolean);
        const camelParts = token.split(/(?=[A-Z])/).filter(Boolean);
        return [...snakeParts, ...camelParts, token].filter(t => t.length > 1);
      })
      .map(t => t.toLowerCase())
      .filter(t => t.length > 1 && t.length < 30 && !/^\d+$/.test(t));
  }

  /**
   * L2 normalize a vector
   */
  private normalize(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vector;
    return vector.map(v => v / magnitude);
  }

  /**
   * Compute cosine similarity between two vectors
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }
    return dotProduct; // Vectors are already normalized
  }

  /**
   * Get embedding dimension
   */
  getDimension(): number {
    return this.config.dimension;
  }

  /**
   * Check if using neural embeddings
   */
  isNeuralEnabled(): boolean {
    return this.isInitialized && !this.useFallback;
  }

  /**
   * Get model info
   */
  getModelInfo(): { model: string; type: string; dimension: number } {
    return {
      model: this.useFallback ? 'TF-IDF (fallback)' : this.config.modelName,
      type: this.useFallback ? 'tfidf' : 'neural',
      dimension: this.config.dimension,
    };
  }
}
