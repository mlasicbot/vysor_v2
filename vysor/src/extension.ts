// © ASICBOT Private Limited Inc
// Vysor — main extension entry (webview-based)

import * as vscode from 'vscode';
import { Logger } from './utils/logger';
import { ConfigManager } from './utils/config';
import { Orchestrator } from './core/orchestrator';
import { ChatViewProvider } from './webviewHost/chatViewProvider';

export async function activate(context: vscode.ExtensionContext) {
  // 1) Logger (OutputChannel + file at context.logUri)
  await Logger.init(context);
  const log = Logger.getInstance();
  log.info('Activating Vysor…');

  try {
    // 2) Load settings
    const cfg = ConfigManager.getInstance().getConfig();

    // 3) Build orchestrator
    const orchestrator = new Orchestrator({
      plannerBaseUrl: cfg.plannerBaseUrl,
      maxIterations: cfg.maxIterations,
      requestTimeoutMs: cfg.requestTimeoutMs,
      modelName: cfg.modelName,
    });

    // 4) Register the chat webview view ( Activity Bar → “Vysor” → “Vysor Chat” )
    const provider = new ChatViewProvider(context, orchestrator, log);
    const viewDisposable = vscode.window.registerWebviewViewProvider(
      'vysor.chatView', // must match package.json views[].id
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    );
    context.subscriptions.push(viewDisposable);

    // 5) Respond to settings changes (hot apply)
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to activate Vysor: ${msg}`);
    Logger.getInstance().error('Activation failed', err);
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

// import * as vscode from 'vscode';
// import { Orchestrator } from './core/orchestrator';
// // import { FileOperationTools } from './tools';

// export function activate(context: vscode.ExtensionContext) {
//   // Create an orchestrator instance
//   const orchestrator = new Orchestrator({
//     plannerBaseUrl: "http://127.0.0.1:8000", // your FastAPI server
//     maxIterations: 5
//   });

//   // Register the command
//   const disposable = vscode.commands.registerCommand('vysor.runPlannerTest', async () => {
//     const query = await vscode.window.showInputBox({
//       prompt: 'Enter a test query',
//       value: 'List all files in a directory called "vysor"'
//     });
//     if (!query) return;

//     const outputChannel = vscode.window.createOutputChannel('Vysor Planner Test');
//     outputChannel.show(true);

//     const result = await orchestrator.processQuery(
//       { query },
//       (text, done) => {
//         outputChannel.appendLine(text);
//         if (done) outputChannel.appendLine('\n[Done]');
//       }
//     );

//     vscode.window.showInformationMessage(`Final result: ${result}`);
//   });

//   // Add it to disposables so it’s cleaned up on deactivate
//   context.subscriptions.push(disposable);
// }
