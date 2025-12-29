// © ASICBOT Private Limited Inc
// Vysor — main extension entry (webview-based)

import * as vscode from 'vscode';
import { Logger } from './utils/logger';
import { ConfigManager } from './utils/config';
import { Orchestrator } from './core/orchestrator';
import { ChatViewProvider } from './webviewHost/chatViewProvider';

// Global reference for shadow workspace status bar
let shadowStatusBarItem: vscode.StatusBarItem | undefined;

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

    // ═══════════════════════════════════════════════════════════════════════════
    // SHADOW WORKSPACE - Editor Controls
    // ═══════════════════════════════════════════════════════════════════════════

    // Status Bar Item for pending changes
    shadowStatusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    shadowStatusBarItem.command = 'vysor.shadow.review';
    context.subscriptions.push(shadowStatusBarItem);

    // Update status bar and context keys
    const updateShadowStatus = () => {
      const hasPending = orchestrator.hasPendingChanges();
      const pending = orchestrator.getPendingEdits();
      const summary = orchestrator.getPendingChangesSummary();
      
      // Update context keys for menu visibility
      vscode.commands.executeCommand('setContext', 'vysor.hasPendingChanges', hasPending);
      
      // Check if current file has pending changes
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (ws) {
          const relativePath = vscode.workspace.asRelativePath(activeEditor.document.uri, false);
          const fileHasPending = pending.some(e => e.path === relativePath);
          vscode.commands.executeCommand('setContext', 'vysor.fileHasPendingChanges', fileHasPending);
        }
      }
      
      // Update status bar
      if (hasPending && summary) {
        const adds = summary.additions > 0 ? `+${summary.additions}` : '';
        const dels = summary.deletions > 0 ? `-${summary.deletions}` : '';
        const stats = [adds, dels].filter(Boolean).join(' ');
        shadowStatusBarItem!.text = `$(git-pull-request) ${summary.totalFiles} pending ${stats}`;
        shadowStatusBarItem!.tooltip = `Vysor: ${summary.totalFiles} file(s) with pending changes\nClick to review`;
        shadowStatusBarItem!.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        shadowStatusBarItem!.show();
      } else {
        shadowStatusBarItem!.hide();
      }
    };

    // Listen for shadow workspace events
    const unsubscribeShadow = orchestrator.onShadowEvent((event) => {
      log.info('[Shadow] Event received', event);
      updateShadowStatus();
    });
    context.subscriptions.push({ dispose: unsubscribeShadow });

    // Update on editor change
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => updateShadowStatus())
    );

    // Register Shadow Workspace commands
    context.subscriptions.push(
      vscode.commands.registerCommand('vysor.shadow.acceptAll', async () => {
        try {
          const result = await orchestrator.acceptAllEdits();
          if (result.success) {
            vscode.window.showInformationMessage(
              `✅ Applied ${result.committedPaths.length} file(s)`
            );
          } else {
            vscode.window.showWarningMessage(
              `⚠️ Some changes failed: ${result.failedPaths.map(f => f.path).join(', ')}`
            );
          }
          updateShadowStatus();
          // Sync with webview
          provider.refreshPendingChanges();
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to apply changes: ${e}`);
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('vysor.shadow.review', async () => {
        const pending = orchestrator.getPendingEdits();
        if (pending.length === 0) {
          vscode.window.showInformationMessage('No pending changes to review');
          return;
        }

        // Show quick pick with pending files
        const items = pending.map(e => ({
          label: `$(${getIconForOperation(e.operationType)}) ${e.path}`,
          description: e.description || formatDiffStats(e),
          detail: `${e.operationType} • ${e.diff?.additions ?? 0} additions, ${e.diff?.deletions ?? 0} deletions`,
          edit: e,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a file to view diff',
          title: `Review Pending Changes (${pending.length} file${pending.length === 1 ? '' : 's'})`,
        });

        if (selected) {
          // Show diff in a new editor
          await showDiffForFile(selected.edit.path, orchestrator);
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('vysor.shadow.rejectAll', async () => {
        const pending = orchestrator.getPendingEdits();
        if (pending.length === 0) {
          vscode.window.showInformationMessage('No pending changes to undo');
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Discard all ${pending.length} pending change(s)?`,
          { modal: true },
          'Discard All'
        );

        if (confirm === 'Discard All') {
          await orchestrator.rejectAllEdits();
          vscode.window.showInformationMessage('↩️ All changes undone');
          updateShadowStatus();
          // Sync with webview
          provider.refreshPendingChanges();
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('vysor.shadow.acceptFile', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) return;

        const relativePath = vscode.workspace.asRelativePath(activeEditor.document.uri, false);
        const edit = orchestrator.getPendingEdits().find(e => e.path === relativePath);
        
        if (!edit) {
          vscode.window.showInformationMessage('No pending changes for this file');
          return;
        }

        const result = await orchestrator.acceptEdit(edit.id);
        if (result.success) {
          vscode.window.showInformationMessage(`✅ Applied changes to ${relativePath}`);
        } else {
          vscode.window.showErrorMessage(`Failed to apply: ${result.summary}`);
        }
        updateShadowStatus();
        // Sync with webview
        provider.refreshPendingChanges();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('vysor.shadow.rejectFile', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) return;

        const relativePath = vscode.workspace.asRelativePath(activeEditor.document.uri, false);
        const edit = orchestrator.getPendingEdits().find(e => e.path === relativePath);
        
        if (!edit) {
          vscode.window.showInformationMessage('No pending changes for this file');
          return;
        }

        await orchestrator.rejectEdit(edit.id);
        vscode.window.showInformationMessage(`↩️ Undone changes to ${relativePath}`);
        updateShadowStatus();
        // Sync with webview
        provider.refreshPendingChanges();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('vysor.shadow.showDiff', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) return;

        const relativePath = vscode.workspace.asRelativePath(activeEditor.document.uri, false);
        await showDiffForFile(relativePath, orchestrator);
      })
    );

    // Initial status update
    updateShadowStatus();
    log.info('Shadow workspace editor controls registered');

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

                  // Get lint diagnostics for the current file (nearby the cursor)
                  const diagnostics = vscode.languages.getDiagnostics(document.uri);
                  const cursorLine = position.line;
                  const nearbyLints = diagnostics
                    .filter(d => Math.abs(d.range.start.line - cursorLine) <= 10)
                    .slice(0, 5)
                    .map(d => ({
                      line: d.range.start.line + 1,
                      message: d.message,
                      severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' 
                        : d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' 
                        : 'info',
                      source: d.source,
                    }));

                  log.info('[inline] calling orchestrator', { 
                    uri: docUri, 
                    beforeLen: before.length, 
                    afterLen: after.length,
                    lintsNearby: nearbyLints.length 
                  });
                  console.log('[inline] calling orchestrator', docUri, 'beforeLen', before.length, 'afterLen', after.length, 'lints', nearbyLints.length);

                  const startTs = Date.now();
                  const completionText = await orchestrator.generateInlineCompletion(
                    before, 
                    after, 
                    document.languageId, 
                    abortController.signal,
                    nearbyLints
                  );
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

// --- Shadow Workspace Helpers ---
function getIconForOperation(op: string): string {
  switch (op) {
    case 'create': return 'new-file';
    case 'modify': return 'edit';
    case 'delete': return 'trash';
    case 'rename':
    case 'move': return 'file-symlink-file';
    default: return 'file';
  }
}

function formatDiffStats(edit: any): string {
  const adds = edit.diff?.additions ?? 0;
  const dels = edit.diff?.deletions ?? 0;
  const parts: string[] = [];
  if (adds > 0) parts.push(`+${adds}`);
  if (dels > 0) parts.push(`-${dels}`);
  return parts.join(' ') || 'no changes';
}

async function showDiffForFile(relativePath: string, orchestrator: Orchestrator): Promise<void> {
  const pending = orchestrator.getPendingEdits().find(e => e.path === relativePath);
  if (!pending) {
    vscode.window.showInformationMessage(`No pending changes for ${relativePath}`);
    return;
  }

  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) return;

  // Register content providers if not already registered
  const originalScheme = 'vysor-original';
  const proposedScheme = 'vysor-proposed';
  
  if (!diffContentProviderRegistered) {
    const provider = new VysorDiffContentProvider();
    vscode.workspace.registerTextDocumentContentProvider(proposedScheme, provider);
    vscode.workspace.registerTextDocumentContentProvider(originalScheme, provider);
    diffContentProviderRegistered = true;
    diffContentProviderRef = provider;
  }

  const timestamp = Date.now();
  
  // For NEW files: use virtual empty document as original
  // For EXISTING files: use virtual document with original content
  const isNewFile = pending.operationType === 'create' || pending.originalContent === null;
  
  let originalUri: vscode.Uri;
  if (isNewFile) {
    // New file: create virtual empty document
    originalUri = vscode.Uri.parse(`${originalScheme}:/${relativePath}?type=original&ts=${timestamp}`);
    if (diffContentProviderRef) {
      diffContentProviderRef.setContent(originalUri.toString(), ''); // Empty for new files
    }
  } else {
    // Existing file: create virtual document with original content
    originalUri = vscode.Uri.parse(`${originalScheme}:/${relativePath}?type=original&ts=${timestamp}`);
    if (diffContentProviderRef) {
      diffContentProviderRef.setContent(originalUri.toString(), pending.originalContent ?? '');
    }
  }
  
  // Create virtual document for proposed content
  const proposedUri = vscode.Uri.parse(`${proposedScheme}:/${relativePath}?type=proposed&ts=${timestamp}`);
  if (diffContentProviderRef && pending.newContent !== null) {
    diffContentProviderRef.setContent(proposedUri.toString(), pending.newContent);
  }

  // Open diff editor
  const opLabel = isNewFile ? 'New File' : 'Pending Changes';
  const title = `${relativePath} (${opLabel})`;
  await vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, title);
}

// Diff content provider for virtual documents
let diffContentProviderRegistered = false;
let diffContentProviderRef: VysorDiffContentProvider | undefined;

class VysorDiffContentProvider implements vscode.TextDocumentContentProvider {
  private contents = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  
  get onDidChange(): vscode.Event<vscode.Uri> {
    return this._onDidChange.event;
  }

  setContent(uri: string, content: string): void {
    this.contents.set(uri, content);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }
}