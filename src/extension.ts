// © ASICBOT Private Limited Inc
// Vysor — main extension entry (webview-based)

import * as vscode from 'vscode';
import { Logger } from './utils/logger';
import { ConfigManager } from './utils/config';
import { Orchestrator } from './core/orchestrator';
import { ChatViewProvider } from './webviewHost/chatViewProvider';

export async function activate(context: vscode.ExtensionContext) {
  // 1) Logger (OutputChannel + file at context.logUri)
  // console.log(">>> Vysor activate() called");
  
  try {
    await Logger.init(context);
    const log = Logger.getInstance();
    log.info('Activating Vysor…');
  } catch (error) {
    console.error('Failed to initialize Logger:', error);
    // Continue without file logging, but show error
    vscode.window.showErrorMessage(`Vysor: Failed to initialize logging: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  const log = Logger.getInstance();

  try {
    // 2) Load settings
    log.info('Loading configuration...');
    const cfg = ConfigManager.getInstance().getConfig();
    log.info('Configuration loaded successfully', { config: cfg });

    // 3) Build orchestrator
    log.info('Building orchestrator...');
    const orchestrator = new Orchestrator({
      plannerBaseUrl: cfg.plannerBaseUrl,
      maxIterations: cfg.maxIterations,
      requestTimeoutMs: cfg.requestTimeoutMs,
      modelName: cfg.modelName,
      networkRetries: (cfg as any).networkRetries,
      networkRetryBackoffMs: (cfg as any).networkRetryBackoffMs
    });
    log.info('Orchestrator built successfully');

    // 4) Register the chat webview view ( Activity Bar → "Vysor" → "Vysor Chat" )
    log.info('Registering ChatViewProvider...');
    const provider = new ChatViewProvider(context, orchestrator, log);
    log.info('ChatViewProvider created successfully');
    
    log.info('Registering webview view provider with ID: vysor.chatView');
    log.info('=== REGISTERING WEBVIEW VIEW PROVIDER ===');
    log.info('Provider object created:', { providerType: typeof provider, hasResolveMethod: typeof provider.resolveWebviewView === 'function' });
    log.info('View type to register:', 'vysor.chatView');
    
    const viewDisposable = vscode.window.registerWebviewViewProvider(
      'vysor.chatView', // must match package.json views[].id
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    );
    
    log.info('=== WEBVIEW VIEW PROVIDER REGISTERED ===');
    log.info('Disposable object:', { disposableType: typeof viewDisposable, hasDisposeMethod: typeof viewDisposable.dispose === 'function' });
    
    log.info('Webview view provider registered successfully');
    context.subscriptions.push(viewDisposable);

    // --- DEBUG: Inline completion provider (temporary, verbose) ---
    try {
      const config = ConfigManager.getInstance().getConfig();
      const inlineEnabled = true; // force for debug
      if (inlineEnabled) {
        // Register for all file editors so language id mismatches are not an issue
        const selector: vscode.DocumentSelector = { scheme: 'file' };

        // Per-document pending request record (single entry per document URI)
        const pending = new Map<string, { timer?: NodeJS.Timeout; abort?: AbortController }>();

        const inlineProvider: vscode.InlineCompletionItemProvider = {
          provideInlineCompletionItems: async (document, position, _context, token) => {
            const docUri = document.uri.toString();
            // quick log entry
            log.info('[inline] called', { uri: docUri, pos: `${position.line}:${position.character}` });
            console.log('[inline] called', docUri, position.line, position.character);

            // Cancel existing pending
            const prev = pending.get(docUri);
            if (prev) {
              if (prev.timer) { clearTimeout(prev.timer); log.info('[inline] cleared timer for', docUri); }
              if (prev.abort) { prev.abort.abort(); log.info('[inline] aborted prev for', docUri); }
              pending.delete(docUri);
            }

            // debug: no debounce to see immediate calls
            const debounceMs = 0;

            const promise = new Promise<vscode.InlineCompletionList>(resolve => {
              const timer = setTimeout(async () => {
                const abortController = new AbortController();
                token.onCancellationRequested(() => {
                  abortController.abort();
                  log.info('[inline] token cancellation requested', { uri: docUri });
                  console.log('[inline] token cancellation requested', docUri);
                });
                pending.set(docUri, { timer: undefined, abort: abortController });

                try {
                  // Prepare compact before/after context around cursor
                  const before = (() => {
                    const maxChars = 1024;
                    const full = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
                    return full.length > maxChars ? full.slice(full.length - maxChars) : full;
                  })();
                  const after = (() => {
                    const endPos = new vscode.Position(Math.min(document.lineCount - 1, position.line + 50), 0);
                    return document.getText(new vscode.Range(position, endPos)).slice(0, 512);
                  })();

                  log.info('[inline] calling orchestrator', { uri: docUri, beforeLen: before.length, afterLen: after.length });
                  console.log('[inline] calling orchestrator', docUri, 'beforeLen', before.length, 'afterLen', after.length);

                  const startTs = Date.now();
                  const completionText = await orchestrator.generateInlineCompletion(before, after, document.languageId, abortController.signal);
                  const elapsed = Date.now() - startTs;

                  log.info('[inline] orchestrator returned', { uri: docUri, len: (completionText || '').length, elapsedMs: elapsed });
                  console.log('[inline] orchestrator returned', docUri, 'len', (completionText || '').length, 'elapsed', elapsed);

                  pending.delete(docUri);

                  if (!completionText) {
                    resolve(new vscode.InlineCompletionList([]));
                    return;
                  }

                  // replace current token to the right
                  const replaceRange = ((): vscode.Range => {
                    const line = document.lineAt(position.line).text;
                    let end = position.character;
                    while (end < line.length && /[A-Za-z0-9_$]/.test(line[end])) end++;
                    return new vscode.Range(position, new vscode.Position(position.line, end));
                  })();

                  const item = new vscode.InlineCompletionItem(completionText, replaceRange);
                  // add telemetry command (optional) — keep it inert for now
                  resolve(new vscode.InlineCompletionList([item]));
                } catch (err) {
                  log.error('[inline] orchestrator error', err);
                  console.error('[inline] orchestrator error', err);
                  pending.delete(docUri);
                  resolve(new vscode.InlineCompletionList([]));
                }
              }, debounceMs);

              pending.set(docUri, { timer, abort: undefined });
            });

            return await promise;
          }
        };

        const d = vscode.languages.registerInlineCompletionItemProvider(selector, inlineProvider);
        context.subscriptions.push(d);
        log.info('[inline] DEBUG provider registered for all files');
        console.log('[inline] DEBUG provider registered for all files');
      }
    } catch (e) {
      log.warn('Inline completion registration failed (debug)', e);
      console.warn('Inline completion registration failed (debug)', e);
    }


    // // --- Inline completion provider for HDL & other languages ---
    // try {
    //   const config = ConfigManager.getInstance().getConfig();
    //   const inlineEnabled = vscode.workspace.getConfiguration('vysor').get('inlineCompletion.enabled', true) as boolean;
    //   if (inlineEnabled) {
    //     const hdlLang = config.hdlDefaultLanguage || 'verilog';
    //     const languageIds = [hdlLang, 'verilog', 'vhdl', 'systemverilog', 'python', 'javascript'];

    //     // Per-document pending request record (single entry per document URI)
    //     const pending = new Map<string, { timer?: NodeJS.Timeout; abort?: AbortController }>();

    //     const inlineProvider: vscode.InlineCompletionItemProvider = {
    //       provideInlineCompletionItems: async (document, position, _context, token) => {
    //         try {
    //           const enabled = vscode.workspace.getConfiguration('vysor').get('inlineCompletion.enabled', true) as boolean;
    //           if (!enabled) return new vscode.InlineCompletionList([]);

    //           const debounceMs = vscode.workspace.getConfiguration('vysor').get('inlineCompletion.debounceMs', 180) as number;
    //           const docUri = document.uri.toString();

    //           // Cancel any pending request for this document
    //           const prev = pending.get(docUri);
    //           if (prev) {
    //             if (prev.timer) clearTimeout(prev.timer);
    //             if (prev.abort) prev.abort.abort();
    //             pending.delete(docUri);
    //           }

    //           // Return a promise that resolves after debounce and orchestrator call
    //           const promise = new Promise<vscode.InlineCompletionList>(resolve => {
    //             const timer = setTimeout(async () => {
    //               // Wire cancellation
    //               const abortController = new AbortController();
    //               token.onCancellationRequested(() => abortController.abort());
    //               pending.set(docUri, { timer: undefined, abort: abortController });

    //               try {
    //                 // Prepare compact before/after context around cursor
    //                 // Use at most last ~1024 chars before the cursor and few lines after
    //                 const before = (() => {
    //                   const maxChars = 1024;
    //                   const full = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    //                   return full.length > maxChars ? full.slice(full.length - maxChars) : full;
    //                 })();
    //                 const after = (() => {
    //                   const endPos = new vscode.Position(Math.min(document.lineCount - 1, position.line + 50), 0);
    //                   return document.getText(new vscode.Range(position, endPos)).slice(0, 512);
    //                 })();

    //                 const completionText = await orchestrator.generateInlineCompletion(before, after, document.languageId, abortController.signal);
    //                 pending.delete(docUri);

    //                 if (!completionText) { resolve(new vscode.InlineCompletionList([])); return; }

    //                 // Compute replace range: replace the identifier/word to the right of the cursor if present
    //                 const replaceRange = computeReplaceRange(document, position);

    //                 const item = new vscode.InlineCompletionItem(completionText, replaceRange);
    //                 resolve(new vscode.InlineCompletionList([item]));
    //               } catch (err) {
    //                 pending.delete(docUri);
    //                 resolve(new vscode.InlineCompletionList([]));
    //               }
    //             }, debounceMs);

    //             pending.set(docUri, { timer, abort: undefined });
    //           });

    //           return await promise;
    //         } catch (e) {
    //           return new vscode.InlineCompletionList([]);
    //         }
    //       }
    //     };

    //     // Helper: replace current word/token to the right of the cursor (so we don't duplicate)
    //     function computeReplaceRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
    //       const line = document.lineAt(position.line).text;
    //       let end = position.character;
    //       while (end < line.length && /[A-Za-z0-9_$]/.test(line[end])) end++;
    //       return new vscode.Range(position, new vscode.Position(position.line, end));
    //     }

    //     const disposables = languageIds.map(id =>
    //       vscode.languages.registerInlineCompletionItemProvider({ language: id }, inlineProvider)
    //     );
    //     disposables.forEach(d => context.subscriptions.push(d));
    //     log.info('Inline completion provider registered for languages:', languageIds.join(', '));
    //   }
    // } catch (e) {
    //   log.warn('Inline completion registration failed', e);
    // }    

    // 5) Respond to settings changes (hot apply)
    log.info('Setting up configuration change watcher...');
    const cfgWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('vysor')) return;
      const updated = ConfigManager.getInstance().getConfig();

      log.info('Vysor settings changed', {
        plannerBaseUrl: updated.plannerBaseUrl,
        maxIterations: updated.maxIterations,
        modelName: updated.modelName,
        requestTimeoutMs: updated.requestTimeoutMs,
      });

      orchestrator.updateConfig({
        plannerBaseUrl: updated.plannerBaseUrl,
        maxIterations: updated.maxIterations,
        requestTimeoutMs: updated.requestTimeoutMs,
        modelName: updated.modelName,
        networkRetries: (updated as any).networkRetries,
        networkRetryBackoffMs: (updated as any).networkRetryBackoffMs,
      });

      // Optional: notify the webview so it can show a toast / update UI
      provider.notifyConfigChanged?.(updated);
    });


    context.subscriptions.push(cfgWatcher);
    context.subscriptions.push(
  vscode.commands.registerCommand('vysor.testInlineCompletion', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) { vscode.window.showInformationMessage('Open an editor first'); return; }
    const pos = ed.selection.active;
    const before = ed.document.getText(new vscode.Range(new vscode.Position(0,0), pos));
    const endPos = new vscode.Position(Math.min(ed.document.lineCount-1, pos.line+50), 0);
    const after  = ed.document.getText(new vscode.Range(pos, endPos)).slice(0,512);
    try {
      const completion = await orchestrator.generateInlineCompletion(before, after, ed.document.languageId);
      vscode.window.showInformationMessage('Completion: ' + (completion || '(empty)'));
    } catch (e) {
      vscode.window.showErrorMessage('Completion call failed: ' + String(e));
    }
  })
);


    // 6) Gentle validation
    if (!looksLikeUrl(cfg.plannerBaseUrl)) {
      vscode.window.showWarningMessage(
        `Vysor: "vysor.plannerBaseUrl" looks invalid: ${cfg.plannerBaseUrl}. Set it in Settings to enable queries.`
      );
    }

    log.info('Vysor activated successfully.', { logFile: log.getLogFilePath() });
    
    // 7) Verify the view is accessible
    try {
      const views = vscode.window.visibleTextEditors;
      log.info('Extension activation completed. Views should now be available.');
    } catch (err) {
      log.error('Error during final activation check', err);
    }
    
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Activation failed', err);
    vscode.window.showErrorMessage(`Failed to activate Vysor: ${msg}`);
    throw err; // Re-throw to ensure VS Code knows activation failed
  }
}

export function deactivate() {
  const log = Logger.getInstance();
  log.info('Vysor deactivated.');
  log.dispose();
}

// --- helpers ---
function looksLikeUrl(s?: string): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return Boolean(u.protocol && u.host);
  } catch {
    return false;
  }
}