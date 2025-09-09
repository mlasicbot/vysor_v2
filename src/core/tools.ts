// © ASICBOT Private Limited Inc
// File operation tools for Vysor orchestrator (safe & workspace-bound)

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

type Json = Record<string, unknown> | string | number | boolean | null;

export interface FileToolsOptions {
  allowFileWrites?: boolean;
  workspaceRootOnly?: boolean;
  maxReadBytes?: number;
  revealEditedFiles?: boolean;
}

export class FileOperationTools {
  private readonly allowFileWrites: boolean;
  private readonly workspaceRootOnly: boolean;
  private readonly maxReadBytes: number;
  private readonly revealEditedFiles: boolean;

  constructor(opts?: FileToolsOptions) {
    this.allowFileWrites = opts?.allowFileWrites ?? true;
    this.workspaceRootOnly = opts?.workspaceRootOnly ?? true;
    this.maxReadBytes = opts?.maxReadBytes ?? 1 * 1024 * 1024; // 1 MiB
    this.revealEditedFiles = opts?.revealEditedFiles ?? false;
  }

  // --- Public entrypoint ---
  async executeFileOperation(toolName: string, toolOutput: any): Promise<string> {
    const lower = (toolName || '').toLowerCase();
    try {
      const workspacePath = this.getWorkspacePath();

      // Reasoning tools
      if (lower === 'simple_query') {
        const ans = typeof toolOutput?.answer === 'string' ? toolOutput.answer : '';
        const fin = typeof toolOutput?.final_answer === 'string' ? (toolOutput as any).final_answer : '';
        const text = (ans || fin || (typeof toolOutput === 'string' ? toolOutput : '')).trim();
        // Avoid dumping raw JSON when the model emitted empty fields
        return text || '(no answer produced)';
      }
      if (lower === 'final_answer') {
        const fin = typeof toolOutput?.final_answer === 'string' ? toolOutput.final_answer : '';
        const text = (fin || (typeof toolOutput === 'string' ? toolOutput : '')).trim();
        return text || '(no answer produced)';
      }

      switch (lower) {
        // Files
        case 'create_file':          return this.requireWrites(await this.createFile(workspacePath, toolOutput));
        case 'open_file':            return this.openFile(workspacePath, toolOutput);
        case 'read_file':            return this.readFile(workspacePath, toolOutput);
        case 'write_file':           return this.requireWrites(await this.writeFile(workspacePath, toolOutput, false));
        case 'rename_file':          return this.requireWrites(await this.renameFile(workspacePath, toolOutput));
        case 'move_file':            return this.requireWrites(await this.moveFile(workspacePath, toolOutput));
        case 'copy_file':            return this.requireWrites(await this.copyFile(workspacePath, toolOutput));
        case 'delete_file':          return this.requireWrites(await this.deleteFile(workspacePath, toolOutput));

        // Directories
        case 'create_directory':     return this.requireWrites(await this.createDirectory(workspacePath, toolOutput));
        case 'list_files':           return this.listFiles(workspacePath, toolOutput);
        case 'list_directories':     return this.listDirectories(workspacePath, toolOutput);
        case 'directory_structure':  return this.generateDirectoryStructure(workspacePath, toolOutput?.file_path);
        case 'rename_directory':     return this.requireWrites(await this.renameDirectory(workspacePath, toolOutput));
        case 'move_directory':       return this.requireWrites(await this.moveDirectory(workspacePath, toolOutput));
        case 'copy_directory':       return this.requireWrites(await this.copyDirectory(workspacePath, toolOutput));
        case 'delete_directory':     return this.requireWrites(await this.deleteDirectory(workspacePath, toolOutput));

        // Checks
        case 'check_file_exists':     return this.checkFileExists(workspacePath, toolOutput);
        case 'check_directory_exists':return this.checkDirectoryExists(workspacePath, toolOutput);

        default:
          if (typeof toolOutput === 'object' && toolOutput && 'answer' in toolOutput) {
            return String((toolOutput as any).answer);
          }
          return `Operation completed: ${this.safeString(toolOutput)}`;
      }
    } catch (err) {
      // IMPORTANT: Always return a string; never throw up to Orchestrator
      return `Error executing ${toolName}: ${this.prettyError(err)}`;
    }
  }

  private sanitizePathToken(s: string): string {
  // Trim whitespace
  let t = s.trim();

  // Strip surrounding quotes/backticks once:  `foo`, 'foo', "foo"
  t = t.replace(/^([`'"])(.*)\1$/s, '$2');

  // If someone pasted a fenced block, drop fence lines completely
  if (t.includes('```')) {
    // keep only lines that are not fences and not blank
    t = t.split('\n')
         .filter(l => !/^```/.test(l.trim()))
         .join('\n')
         .trim();
  }

  // Also strip stray leading/trailing backticks/quotes again after fence cleanup
  t = t.replace(/^[`'"]+|[`'"]+$/g, '');

  return t;
}

  // ---- File ops ----

  private async createFile(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const content = typeof args?.content === 'string' ? args.content : '';
    const filePath = this.resolveSafe(workspacePath, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    if (this.revealEditedFiles) await this.tryReveal(filePath);
    return `✅ File created: ${this.relForMsg(workspacePath, filePath)}`;
  }

  private async openFile(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const filePath = this.resolveSafe(workspacePath, rel);
    await this.tryReveal(filePath);
    return `📂 Opened file: ${rel}`;
  }

  private async readFile(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const filePath = this.resolveSafe(workspacePath, rel);

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return `⚠️ Not a regular file: ${this.relForMsg(workspacePath, filePath)}`;

    if (stat.size > this.maxReadBytes) {
      const head = await this.readHead(filePath, Math.min(this.maxReadBytes, 64 * 1024));
      return `**File: ${rel}** (size: ${stat.size} bytes — showing first ${head.length} bytes)\n\n${head}`;
    }

    const content = await fs.readFile(filePath, 'utf8');
    return `**File: ${rel}**\n\n${content}`;
  }

  private async writeFile(workspacePath: string, args: any, append: boolean): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const content = typeof args?.content === 'string' ? args.content : '';
    const filePath = this.resolveSafe(workspacePath, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (append) await fs.appendFile(filePath, content, 'utf8'); else await fs.writeFile(filePath, content, 'utf8');
    if (this.revealEditedFiles) await this.tryReveal(filePath);
    return append ? `📝 Appended to file: ${rel}` : `✏️ Wrote file: ${rel}`;
  }

  private async deleteFile(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const filePath = this.resolveSafe(workspacePath, rel);
    await fs.unlink(filePath);
    return `🗑️ Deleted file: ${rel}`;
  }

  private async renameFile(workspacePath: string, args: any): Promise<string> {
    const oldRel = this.requireStringArg(args?.old_file_path, 'old_file_path');
    const newRel = this.requireStringArg(args?.new_file_path, 'new_file_path');
    const oldPath = this.resolveSafe(workspacePath, oldRel);
    const newPath = this.resolveSafe(workspacePath, newRel);
    await fs.mkdir(path.dirname(newPath), { recursive: true });
    await fs.rename(oldPath, newPath);
    if (this.revealEditedFiles) await this.tryReveal(newPath);
    return `🔄 Renamed: ${oldRel} → ${newRel}`;
  }

  private async moveFile(workspacePath: string, args: any): Promise<string> {
    const srcRel = this.requireStringArg(args?.source_file_path, 'source_file_path');
    const dstRel = this.requireStringArg(args?.destination_file_path, 'destination_file_path');
    const src = this.resolveSafe(workspacePath, srcRel);
    const dst = this.resolveSafe(workspacePath, dstRel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
    if (this.revealEditedFiles) await this.tryReveal(dst);
    return `📦 Moved file: ${srcRel} → ${dstRel}`;
  }

  private async copyFile(workspacePath: string, args: any): Promise<string> {
    const srcRel = this.requireStringArg(args?.source_file_path, 'source_file_path');
    const dstRel = this.requireStringArg(args?.destination_file_path, 'destination_file_path');
    const src = this.resolveSafe(workspacePath, srcRel);
    const dst = this.resolveSafe(workspacePath, dstRel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await (fs as any).cp?.(src, dst, { force: true }) ?? fs.copyFile(src, dst);
    if (this.revealEditedFiles) await this.tryReveal(dst);
    return `📑 Copied file: ${srcRel} → ${dstRel}`;
  }

  // ---- Directory ops ----

  private async createDirectory(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const dir = this.resolveSafe(workspacePath, rel);
    await fs.mkdir(dir, { recursive: true });
    return `📁 Directory created: ${rel}`;
  }

  private async listFiles(workspacePath: string, args: any): Promise<string> {
    const relDir = typeof args?.file_path === 'string' && args.file_path.trim() ? args.file_path : '.';
    const dirPath = this.resolveSafe(workspacePath, relDir);
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const files = entries.filter(e => !e.isDirectory()).map(e => e.name).sort();
      if (files.length === 0) return `📋 No files in ${relDir}`;
      return `Files in ${relDir}:\n\n${files.map(n => `📄 ${n}`).join('\n')}`;
    } catch (e: any) {
      return this.fsError('list_files', relDir, e);
    }
  }

  private async listDirectories(workspacePath: string, args: any): Promise<string> {
    const relDir = typeof args?.file_path === 'string' && args.file_path.trim() ? args.file_path : '.';
    const dirPath = this.resolveSafe(workspacePath, relDir);
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
      if (dirs.length === 0) return `📂 No subdirectories in ${relDir}`;
      return `Directories in ${relDir}:\n\n${dirs.map(n => `📁 ${n}`).join('\n')}`;
    } catch (e: any) {
      return this.fsError('list_directories', relDir, e);
    }
  }

  private async renameDirectory(workspacePath: string, args: any): Promise<string> {
    const oldRel = this.requireStringArg(args?.old_file_path, 'old_file_path');
    const newRel = this.requireStringArg(args?.new_file_path, 'new_file_path');
    const oldPath = this.resolveSafe(workspacePath, oldRel);
    const newPath = this.resolveSafe(workspacePath, newRel);
    await fs.mkdir(path.dirname(newPath), { recursive: true });
    await fs.rename(oldPath, newPath);
    return `🔄 Renamed directory: ${oldRel} → ${newRel}`;
  }

  private async moveDirectory(workspacePath: string, args: any): Promise<string> {
    const srcRel = this.requireStringArg(args?.source_file_path, 'source_file_path');
    const dstRel = this.requireStringArg(args?.destination_file_path, 'destination_file_path');
    const src = this.resolveSafe(workspacePath, srcRel);
    const dst = this.resolveSafe(workspacePath, dstRel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
    return `📦 Moved directory: ${srcRel} → ${dstRel}`;
  }

  private async copyDirectory(workspacePath: string, args: any): Promise<string> {
    const srcRel = this.requireStringArg(args?.source_file_path, 'source_file_path');
    const dstRel = this.requireStringArg(args?.destination_file_path, 'destination_file_path');
    const src = this.resolveSafe(workspacePath, srcRel);
    const dst = this.resolveSafe(workspacePath, dstRel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    const cp = (fs as any).cp;
    if (typeof cp === 'function') await cp(src, dst, { force: true, recursive: true });
    else throw new Error('Recursive copy not supported on this Node version');
    return `📑 Copied directory: ${srcRel} → ${dstRel}`;
  }

  private async deleteDirectory(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const dirPath = this.resolveSafe(workspacePath, rel);
    await fs.rm(dirPath, { recursive: true, force: true });
    return `🗑️ Deleted directory: ${rel}`;
  }

  // ---- Existence checks ----

  private async checkFileExists(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const filePath = this.resolveSafe(workspacePath, rel);
    try {
      const st = await fs.stat(filePath);
      return st.isFile() ? `✅ File exists: ${rel}` : `⚠️ Not a file: ${rel}`;
    } catch (e: any) {
      return this.fsError('check_file_exists', rel, e);
    }
  }

  private async checkDirectoryExists(workspacePath: string, args: any): Promise<string> {
    const rel = this.requireStringArg(args?.file_path, 'file_path');
    const dirPath = this.resolveSafe(workspacePath, rel);
    try {
      const st = await fs.stat(dirPath);
      return st.isDirectory() ? `✅ Directory exists: ${rel}` : `⚠️ Not a directory: ${rel}`;
    } catch (e: any) {
      return this.fsError('check_directory_exists', rel, e);
    }
  }

  // ---- Directory Structure Generation ----

  async generateDirectoryStructure(workspacePath: string, relPath: string = '.'): Promise<string> {
    try {
      const dirPath = this.resolveSafe(workspacePath, relPath);
      const structure = await this.buildDirectoryTree(dirPath, relPath);
      return structure;
    } catch (e: any) {
      return `Error generating directory structure: ${this.prettyError(e)}`;
    }
  }

  private async buildDirectoryTree(dirPath: string, relPath: string, depth: number = 0): Promise<string> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const sortedEntries = entries.sort((a, b) => {
        // Directories first, then files, both alphabetically
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      let tree = '';
      const indent = '│   '.repeat(depth);
      const lastIndent = '    '.repeat(depth);

      for (let i = 0; i < sortedEntries.length; i++) {
        const entry = sortedEntries[i];
        const isLast = i === sortedEntries.length - 1;
        const currentIndent = isLast ? lastIndent : indent;
        const connector = isLast ? '└──' : '├──';
        
        if (entry.isDirectory()) {
          tree += `${currentIndent}${connector}${entry.name}                   -- contains code for ${entry.name}\n`;
          const subDirPath = path.join(dirPath, entry.name);
          const subTree = await this.buildDirectoryTree(subDirPath, path.join(relPath, entry.name), depth + 1);
          tree += subTree;
        } else {
          tree += `${currentIndent}${connector}${entry.name}\n`;
        }
      }

      return tree;
    } catch (error) {
      const currentIndent = '│   '.repeat(depth);
      return `${currentIndent}└──[Error reading directory: ${error}]\n`;
    }
  }

  // ---- Finalization hints (used by Orchestrator) ----

  isFinalResponse(toolName: string, toolOutput: any): boolean {
    const t = (toolName || '').toLowerCase();
    if (t === 'simple_query') {
      const ans = typeof toolOutput?.answer === 'string' ? toolOutput.answer : '';
      const fin = typeof toolOutput?.final_answer === 'string' ? toolOutput.final_answer : '';
      const text = (ans || fin || (typeof toolOutput === 'string' ? toolOutput : '')).trim();
      return text.length > 0;
    }
    if (t === 'final_answer') {
      const fin = typeof toolOutput?.final_answer === 'string' ? toolOutput.final_answer : '';
      const text = (fin || (typeof toolOutput === 'string' ? toolOutput : '')).trim();
      return text.length > 0;
    }
    const finals = new Set(['respond', 'final_response', 'complete']);
    if (finals.has(t)) return true;
    if (toolOutput && typeof toolOutput === 'object' && (toolOutput as any).final === true) return true;
    if (typeof toolOutput === 'string' && /final response:/i.test(toolOutput)) return true;
    // directory_structure is not a final response
    if (t === 'directory_structure') return false;
    return false;
  }

  formatProgressMessage(toolName: string, result: string, step: number): string {
    const map: Record<string, string> = {
      simple_query: '💭',
      final_answer: '✅',
      create_file: '📝', open_file: '📂', read_file: '📖', write_file: '✏️',
      rename_file: '🔄', move_file: '📦', copy_file: '📑', delete_file: '🗑️',
      create_directory: '📁', list_files: '📋', list_directories: '📂', directory_structure: '📁',
      rename_directory: '🔄', move_directory: '📦', copy_directory: '📑', delete_directory: '🗑️',
      check_file_exists: '🔍', check_directory_exists: '🔎',
    };
    const key = (toolName || '').toLowerCase();
    const emoji = map[key] || '⚙️';
    const title = (toolName || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `${emoji} **Step ${step}: ${title}**\n\n${result}`;
  }

  // ---- Internals ----

  getWorkspacePath(): string {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) throw new Error('No workspace folder found');
    return ws.uri.fsPath;
  }

  private requireWrites<T>(result: T): T {
    if (!this.allowFileWrites) throw new Error('Writes are disabled by settings (vysor.allowFileWrites = false)');
    return result;
  }

  private resolveSafe(workspacePath: string, rel: string): string {
    const normalizedRel = this.normalizeRel(rel);
    const abs = path.resolve(workspacePath, normalizedRel);
    if (this.workspaceRootOnly) {
      const wsNorm = this.normalizeAbs(workspacePath);
      const absNorm = this.normalizeAbs(abs);
      if (!absNorm.startsWith(wsNorm)) throw new Error(`Path escapes workspace: "${rel}"`);
    }
    return abs;
  }

  private normalizeRel(p: string): string {
    if (!p || typeof p !== 'string') throw new Error('Invalid path');
    const trimmed = p.trim();
    if (!trimmed) throw new Error('Empty path');
    if (path.isAbsolute(trimmed)) throw new Error('Absolute paths are not allowed');
    if (/^[a-zA-Z]:[\\/]/.test(trimmed)) throw new Error('Drive-absolute paths are not allowed');
    return trimmed.replace(/\\/g, '/');
  }

  private normalizeAbs(p: string): string {
    const full = path.resolve(p);
    return full.endsWith(path.sep) ? full : full + path.sep;
  }

  private async tryReveal(absFilePath: string): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absFilePath));
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch { /* non-fatal */ }
  }

  private async readHead(absFilePath: string, maxBytes: number): Promise<string> {
    const buf = await fs.readFile(absFilePath);
    const head = buf.subarray(0, maxBytes);
    try { return head.toString('utf8'); } catch { return `<<binary ${head.length} bytes>>`; }
  }

  private safeString(v: unknown): string {
    try { return typeof v === 'string' ? v : JSON.stringify(v); }
    catch { return String(v); }
  }

  private prettyError(err: unknown): string {
    if (err instanceof Error) return err.message;
    try { return JSON.stringify(err); } catch { return String(err); }
  }

  private requireStringArg(value: unknown, argName: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing or invalid "${argName}"`);
  const cleaned = this.sanitizePathToken(value);
  if (!cleaned) throw new Error(`Invalid "${argName}" after sanitization`);
  return cleaned;
}

  private relForMsg(workspacePath: string, abs: string): string {
    const ws = this.normalizeAbs(workspacePath);
    const ab = this.normalizeAbs(abs);
    return ab.startsWith(ws) ? ab.slice(ws.length) : abs;
  }

  private fsError(op: string, relPath: string, e: any): string {
    const code = typeof e?.code === 'string' ? e.code : 'ERR';
    const msg = typeof e?.message === 'string' ? e.message : String(e);
    return `❌ ${op} failed for "${relPath}" [${code}]: ${msg}`;
  }
}
