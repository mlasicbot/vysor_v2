import * as vscode from 'vscode';
import { VysorPanel } from './panels/VysorPanel';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('vysor.openChat', () => {
    VysorPanel.show(context.extensionUri);
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
