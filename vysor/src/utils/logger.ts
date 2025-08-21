// © ASICBOT Private Limited Inc
// Logger utility for Vysor — OutputChannel + file logging

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

type Level = 'INFO' | 'WARN' | 'ERROR';

export class Logger {
  private static instance: Logger;
  private output: vscode.OutputChannel;
  private logFilePath?: string;
  private alsoConsole = true; // mirror to Debug Console during dev

  private constructor() {
    this.output = vscode.window.createOutputChannel('Vysor');
  }

  /**
   * Call once in activate(context) to enable file logging.
   */
  static async init(context: vscode.ExtensionContext, filename = 'vysor.log') {
    try {
      // Check if context.logUri is available (might not be during development)
      if (context.logUri) {
        const logDir = context.logUri.fsPath; // dedicated per-session/per-extension log dir
        await fsp.mkdir(logDir, { recursive: true });
        const filePath = path.join(logDir, filename);

        const logger = Logger.getInstance();
        logger.logFilePath = filePath;

        // Optional: rotate if huge (>5 MB)
        try {
          const st = await fsp.stat(filePath);
          if (st.size > 5 * 1024 * 1024) {
            const rotated = filePath.replace(/\.log$/, `-${Date.now()}.log`);
            await fsp.rename(filePath, rotated);
          }
        } catch { /* ignore if file doesn't exist */ }

        logger.info(`File logging enabled at: ${filePath}`);
      } else {
        // Fallback for development or when logUri is not available
        const logger = Logger.getInstance();
        logger.info('File logging not available (context.logUri is undefined) - using OutputChannel only');
      }
    } catch (error) {
      // Fallback if file logging setup fails
      const logger = Logger.getInstance();
      logger.error('Failed to initialize file logging', error);
      logger.info('Falling back to OutputChannel only');
    }
  }

  static getInstance(): Logger {
    if (!Logger.instance) Logger.instance = new Logger();
    return Logger.instance;
  }

  info(message: string, ...params: unknown[]) { this.append('INFO', message, params); }
  warn(message: string, ...params: unknown[]) { this.append('WARN', message, params); }
  error(message: string, ...params: unknown[]) { this.append('ERROR', message, params); }

  show() { this.output.show(true); }
  dispose() { this.output.dispose(); }

  private async writeToFile(line: string) {
    if (!this.logFilePath) return;
    try {
      await fsp.appendFile(this.logFilePath, line + '\n', { encoding: 'utf8' });
    } catch (e) {
      // Fall back to OutputChannel if file write fails
      this.output.appendLine(`[LOGGER] Failed to write to file: ${String(e)}`);
    }
  }

  private append(level: Level, message: string, params: unknown[]) {
    const ts = new Date().toISOString();
    const extra = params?.length ? ' ' + params.map(this.safe).join(' ') : '';
    const line = `[${ts}] [${level}] ${message}${extra}`;

    // Output channel
    this.output.appendLine(line);

    // Debug console mirror (handy while F5 debugging)
    if (this.alsoConsole) {
      if (level === 'ERROR') console.error(line);
      else if (level === 'WARN') console.warn(line);
      else console.log(line);
    }

    // File
    // Fire-and-forget; we don't await to avoid blocking the extension thread
    void this.writeToFile(line);
  }

  private safe(v: unknown): string {
    try {
      if (typeof v === 'string') return v;
      return JSON.stringify(v);
    } catch { return String(v); }
  }

  /**
   * Expose current log file path so you can show it to the user if needed.
   */
  getLogFilePath(): string | undefined {
    return this.logFilePath;
  }
}