// © ASICBOT Private Limited Inc
// AST-Aware Code Chunker for RAG

import * as crypto from 'crypto';
import type { CodeChunk, ChunkType, ChunkerOptions } from './types';

const DEFAULT_OPTIONS: Required<ChunkerOptions> = {
  maxChunkSize: 2000,      // ~500 tokens
  minChunkSize: 100,       // Merge smaller chunks
  contextLines: 2,         // Include context
  supportedLanguages: ['verilog', 'systemverilog', 'python', 'typescript', 'javascript'],
};

/**
 * AST-Aware Code Chunker
 * 
 * Parses code files into semantic chunks based on language-specific patterns.
 * For HDL files, recognizes modules, classes, functions, always blocks, etc.
 */
export class CodeChunker {
  private options: Required<ChunkerOptions>;

  constructor(options?: ChunkerOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Chunk a file into semantic code blocks
   */
  chunkFile(filePath: string, content: string): CodeChunk[] {
    const language = this.detectLanguage(filePath);
    
    if (!this.options.supportedLanguages.includes(language)) {
      // Fallback: chunk by lines for unsupported languages
      return this.chunkByLines(filePath, content, language);
    }

    switch (language) {
      case 'verilog':
      case 'systemverilog':
        return this.chunkSystemVerilog(filePath, content, language);
      case 'python':
        return this.chunkPython(filePath, content);
      case 'typescript':
      case 'javascript':
        return this.chunkTypeScript(filePath, content, language);
      default:
        return this.chunkByLines(filePath, content, language);
    }
  }

  /**
   * Detect language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      'v': 'verilog',
      'vh': 'verilog',
      'sv': 'systemverilog',
      'svh': 'systemverilog',
      'py': 'python',
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'vhd': 'vhdl',
      'vhdl': 'vhdl',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Chunk SystemVerilog/Verilog files
   */
  private chunkSystemVerilog(filePath: string, content: string, language: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    
    // Patterns for SV constructs
    const patterns: { pattern: RegExp; type: ChunkType; endPattern?: RegExp }[] = [
      // Module
      { 
        pattern: /^\s*(module|macromodule)\s+(\w+)/,
        type: 'module',
        endPattern: /^\s*endmodule\b/
      },
      // Class
      {
        pattern: /^\s*(virtual\s+)?class\s+(\w+)/,
        type: 'class',
        endPattern: /^\s*endclass\b/
      },
      // Interface
      {
        pattern: /^\s*interface\s+(\w+)/,
        type: 'interface',
        endPattern: /^\s*endinterface\b/
      },
      // Package
      {
        pattern: /^\s*package\s+(\w+)/,
        type: 'package',
        endPattern: /^\s*endpackage\b/
      },
      // Function/Task
      {
        pattern: /^\s*(virtual\s+)?(function|task)\s+/,
        type: 'function',
        endPattern: /^\s*end(function|task)\b/
      },
      // Always blocks
      {
        pattern: /^\s*(always|always_ff|always_comb|always_latch)\b/,
        type: 'always',
        endPattern: /^\s*end\b/
      },
      // Initial blocks
      {
        pattern: /^\s*initial\b/,
        type: 'initial',
        endPattern: /^\s*end\b/
      },
      // Covergroup
      {
        pattern: /^\s*covergroup\s+(\w+)/,
        type: 'covergroup',
        endPattern: /^\s*endgroup\b/
      },
      // Constraint
      {
        pattern: /^\s*constraint\s+(\w+)/,
        type: 'constraint',
        endPattern: /^\s*}\s*$/
      },
      // Typedef
      {
        pattern: /^\s*typedef\s+/,
        type: 'typedef'
      },
    ];

    let i = 0;
    while (i < lines.length) {
      let matched = false;

      for (const { pattern, type, endPattern } of patterns) {
        const match = lines[i].match(pattern);
        if (match) {
          const startLine = i + 1;
          let endLine = i + 1;
          
          if (endPattern) {
            // Find matching end
            let depth = 1;
            let j = i + 1;
            while (j < lines.length && depth > 0) {
              if (pattern.test(lines[j])) depth++;
              if (endPattern.test(lines[j])) depth--;
              if (depth > 0) j++;
            }
            endLine = j + 1;
          } else {
            // Single-line construct or find semicolon
            let j = i;
            while (j < lines.length && !lines[j].includes(';')) j++;
            endLine = j + 1;
          }

          const chunkContent = lines.slice(i, endLine).join('\n');
          const signature = lines[i].trim();
          const name = match[2] || match[1] || undefined;

          chunks.push(this.createChunk({
            filePath,
            startLine,
            endLine,
            content: chunkContent,
            chunkType: type,
            signature,
            name,
            language,
          }));

          i = endLine;
          matched = true;
          break;
        }
      }

      if (!matched) {
        i++;
      }
    }

    // If no chunks found, fall back to line-based chunking
    if (chunks.length === 0) {
      return this.chunkByLines(filePath, content, language);
    }

    return this.mergeSmallChunks(chunks);
  }

  /**
   * Chunk Python files
   */
  private chunkPython(filePath: string, content: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    
    const patterns: { pattern: RegExp; type: ChunkType }[] = [
      { pattern: /^class\s+(\w+)/, type: 'class' },
      { pattern: /^def\s+(\w+)/, type: 'function' },
      { pattern: /^async\s+def\s+(\w+)/, type: 'function' },
    ];

    let i = 0;
    while (i < lines.length) {
      let matched = false;

      for (const { pattern, type } of patterns) {
        const match = lines[i].match(pattern);
        if (match) {
          const startLine = i + 1;
          const baseIndent = lines[i].search(/\S/);
          
          // Find end by indentation
          let j = i + 1;
          while (j < lines.length) {
            const line = lines[j];
            if (line.trim() === '') {
              j++;
              continue;
            }
            const indent = line.search(/\S/);
            if (indent <= baseIndent && line.trim() !== '') break;
            j++;
          }
          
          const endLine = j;
          const chunkContent = lines.slice(i, endLine).join('\n');

          chunks.push(this.createChunk({
            filePath,
            startLine,
            endLine,
            content: chunkContent,
            chunkType: type,
            signature: lines[i].trim(),
            name: match[1],
            language: 'python',
          }));

          i = endLine;
          matched = true;
          break;
        }
      }

      if (!matched) {
        i++;
      }
    }

    if (chunks.length === 0) {
      return this.chunkByLines(filePath, content, 'python');
    }

    return this.mergeSmallChunks(chunks);
  }

  /**
   * Chunk TypeScript/JavaScript files
   */
  private chunkTypeScript(filePath: string, content: string, language: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    
    const patterns: { pattern: RegExp; type: ChunkType }[] = [
      { pattern: /^(export\s+)?(abstract\s+)?class\s+(\w+)/, type: 'class' },
      { pattern: /^(export\s+)?interface\s+(\w+)/, type: 'interface' },
      { pattern: /^(export\s+)?type\s+(\w+)/, type: 'typedef' },
      { pattern: /^(export\s+)?enum\s+(\w+)/, type: 'enum' },
      { pattern: /^(export\s+)?(async\s+)?function\s+(\w+)/, type: 'function' },
      { pattern: /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?\(/, type: 'function' },
      { pattern: /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?function/, type: 'function' },
    ];

    let i = 0;
    while (i < lines.length) {
      let matched = false;

      for (const { pattern, type } of patterns) {
        const match = lines[i].match(pattern);
        if (match) {
          const startLine = i + 1;
          
          // Find matching brace
          let braceCount = 0;
          let foundOpen = false;
          let j = i;
          
          while (j < lines.length) {
            for (const char of lines[j]) {
              if (char === '{') { braceCount++; foundOpen = true; }
              if (char === '}') braceCount--;
            }
            if (foundOpen && braceCount === 0) break;
            j++;
          }
          
          const endLine = j + 1;
          const chunkContent = lines.slice(i, endLine).join('\n');
          const name = match[3] || match[2] || match[1];

          chunks.push(this.createChunk({
            filePath,
            startLine,
            endLine,
            content: chunkContent,
            chunkType: type,
            signature: lines[i].trim(),
            name,
            language,
          }));

          i = endLine;
          matched = true;
          break;
        }
      }

      if (!matched) {
        i++;
      }
    }

    if (chunks.length === 0) {
      return this.chunkByLines(filePath, content, language);
    }

    return this.mergeSmallChunks(chunks);
  }

  /**
   * Fallback: chunk by lines
   */
  private chunkByLines(filePath: string, content: string, language: string): CodeChunk[] {
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    const linesPerChunk = Math.ceil(this.options.maxChunkSize / 80); // ~80 chars per line
    
    for (let i = 0; i < lines.length; i += linesPerChunk) {
      const startLine = i + 1;
      const endLine = Math.min(i + linesPerChunk, lines.length);
      const chunkContent = lines.slice(i, endLine).join('\n');
      
      if (chunkContent.trim()) {
        chunks.push(this.createChunk({
          filePath,
          startLine,
          endLine,
          content: chunkContent,
          chunkType: 'top_level',
          language,
        }));
      }
    }
    
    return chunks;
  }

  /**
   * Merge chunks that are too small
   */
  private mergeSmallChunks(chunks: CodeChunk[]): CodeChunk[] {
    if (chunks.length <= 1) return chunks;

    const merged: CodeChunk[] = [];
    let current: CodeChunk | null = null;

    for (const chunk of chunks) {
      if (!current) {
        current = { ...chunk };
        continue;
      }

      if (current.content.length < this.options.minChunkSize) {
        // Merge with current
        current.endLine = chunk.endLine;
        current.content += '\n\n' + chunk.content;
        current.contentHash = this.hash(current.content);
      } else {
        merged.push(current);
        current = { ...chunk };
      }
    }

    if (current) {
      merged.push(current);
    }

    return merged;
  }

  /**
   * Create a chunk with computed fields
   */
  private createChunk(params: {
    filePath: string;
    startLine: number;
    endLine: number;
    content: string;
    chunkType: ChunkType;
    language: string;
    signature?: string;
    name?: string;
    parentId?: string;
  }): CodeChunk {
    const contentHash = this.hash(params.content);
    const id = this.hash(`${params.filePath}:${params.startLine}:${contentHash}`);

    return {
      id,
      filePath: params.filePath,
      startLine: params.startLine,
      endLine: params.endLine,
      content: params.content,
      chunkType: params.chunkType,
      signature: params.signature,
      name: params.name,
      parentId: params.parentId,
      language: params.language,
      contentHash,
    };
  }

  /**
   * Compute SHA256 hash
   */
  private hash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}

