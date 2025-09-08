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
