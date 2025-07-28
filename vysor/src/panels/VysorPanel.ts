import * as vscode from 'vscode';
import { resolveContextFromInput } from '../utils/contextResolver';
import { queryASICLLM } from '../utils/llmClient';
import * as fs from 'fs';
import * as path from 'path';

export class VysorPanel {
  public static currentPanel: VysorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private messageHistory: { role: 'user' | 'assistant'; content: string }[] = [];


  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'query':
            const text = message.text;
          
            this.messageHistory.push({ role: 'user', content: text });
          
            const { input, context } = await resolveContextFromInput(text);
            const output = vscode.window.createOutputChannel("Vysor");
            output.appendLine(`[User] ${input}`);
            context.forEach((ctx, i) => output.appendLine(`[Context ${i + 1}]\n${ctx}\n`));
            output.appendLine('🔄 Querying ASIC LLM...');
            output.show(true);
          
            try {
                const reply = await queryASICLLM(input, context, this.messageHistory);
                this.messageHistory.push({ role: 'assistant', content: reply });
          
                output.appendLine(`✅ ASIC LLM:\n${reply}`);
                this.panel.webview.postMessage({ type: 'response', text: reply });
            } catch (err: any) {
                output.appendLine(`❌ Error querying ASIC LLM:\n${err.message}`);
            }
            break;
          case 'getFileStructure':
            const fileStructure = this.getWorkspaceFileStructure();
            this.panel.webview.postMessage({ type: 'fileStructure', files: fileStructure });
            break;
        }
      },
      undefined,
      []
    );

    this.update();
  }

  public static show(extensionUri: vscode.Uri) {
    const column = vscode.ViewColumn.Beside;

    if (VysorPanel.currentPanel) {
      VysorPanel.currentPanel.panel.reveal(column);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'vysorChat',
        'Vysor Chat',
        column,
        {
          enableScripts: true
        }
      );

      VysorPanel.currentPanel = new VysorPanel(panel, extensionUri);
    }
  }

  private update() {
    this.panel.webview.html = this.getHtmlForWebview();
  }

  private getHtmlForWebview(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <style>
          body {
            font-family: sans-serif;
            padding: 1rem;
            background-color: #1e1e1e;
            color: #ffffff;
          }
          #chat {
            height: 80vh;
            border: 1px solid #3c3c3c;
            padding: 1rem;
            overflow-y: auto;
            background-color: #252526;
            border-radius: 4px;
          }
          #input-area {
            display: flex;
            margin-top: 1rem;
            position: relative;
          }
          #query {
            flex-grow: 1;
            padding: 0.5rem;
            background-color: #3c3c3c;
            border: 1px solid #5a5a5a;
            color: #ffffff;
            border-radius: 4px;
          }
          #submit {
            margin-left: 0.5rem;
            padding: 0.5rem 1rem;
            background-color: #007acc;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
          }
          #submit:hover {
            background-color: #005a9e;
          }
          .autocomplete-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background-color: #2d2d30;
            border: 1px solid #5a5a5a;
            border-radius: 4px;
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
          }
          .autocomplete-item {
            padding: 0.5rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            border-bottom: 1px solid #3c3c3c;
          }
          .autocomplete-item:hover {
            background-color: #3c3c3c;
          }
          .autocomplete-item:last-child {
            border-bottom: none;
          }
          .file-icon {
            margin-right: 0.5rem;
            color: #4ec9b0;
          }
          .folder-icon {
            margin-right: 0.5rem;
            color: #ffd700;
          }
          .file-path {
            font-family: monospace;
            font-size: 0.9em;
          }
          .selected {
            background-color: #007acc !important;
          }
        </style>
      </head>
      <body>
        <div id="chat">
          <p><strong>Vysor:</strong> Hello! How can I help you today?</p>
        </div>
        <div id="input-area">
          <input id="query" type="text" placeholder="Ask a hardware question..." />
          <button id="submit">➤</button>
          <div id="autocomplete" class="autocomplete-dropdown"></div>
        </div>
        <script>
        const vscode = acquireVsCodeApi();
        let autocompleteData = [];
        let selectedIndex = -1;

        const queryInput = document.getElementById('query');
        const autocomplete = document.getElementById('autocomplete');
        const submitButton = document.getElementById('submit');

        // Request file structure from extension
        vscode.postMessage({ type: 'getFileStructure' });

        queryInput.addEventListener('input', (e) => {
          const value = e.target.value;
          const atIndex = value.lastIndexOf('@');
          
          if (atIndex !== -1) {
            const searchTerm = value.substring(atIndex + 1);
            showAutocomplete(searchTerm);
          } else {
            hideAutocomplete();
          }
        });

        queryInput.addEventListener('keydown', (e) => {
          if (autocomplete.style.display === 'block') {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              selectedIndex = Math.min(selectedIndex + 1, autocompleteData.length - 1);
              updateSelection();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              selectedIndex = Math.max(selectedIndex - 1, -1);
              updateSelection();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (selectedIndex >= 0 && autocompleteData[selectedIndex]) {
                insertFileReference(autocompleteData[selectedIndex]);
              }
            } else if (e.key === 'Escape') {
              hideAutocomplete();
            }
          }
        });

        function showAutocomplete(searchTerm) {
          const filtered = autocompleteData.filter(item => 
            item.path.toLowerCase().includes(searchTerm.toLowerCase())
          );
          
          if (filtered.length > 0) {
            autocomplete.innerHTML = filtered.map((item, index) => 
              \`<div class="autocomplete-item" data-index="\${index}">
                <span class="\${item.isDirectory ? 'folder-icon' : 'file-icon'}">\${item.isDirectory ? '📁' : '📄'}</span>
                <span class="file-path">\${item.path}</span>
              </div>\`
            ).join('');
            
            autocomplete.style.display = 'block';
            selectedIndex = -1;
            updateSelection();
          } else {
            hideAutocomplete();
          }
        }

        function hideAutocomplete() {
          autocomplete.style.display = 'none';
          selectedIndex = -1;
        }

        function updateSelection() {
          const items = autocomplete.querySelectorAll('.autocomplete-item');
          items.forEach((item, index) => {
            item.classList.toggle('selected', index === selectedIndex);
          });
        }

        function insertFileReference(item) {
          const currentValue = queryInput.value;
          const atIndex = currentValue.lastIndexOf('@');
          const newValue = currentValue.substring(0, atIndex) + '@' + item.path + ' ';
          queryInput.value = newValue;
          queryInput.focus();
          hideAutocomplete();
        }

        // Handle clicks on autocomplete items
        autocomplete.addEventListener('click', (e) => {
          const item = e.target.closest('.autocomplete-item');
          if (item) {
            const index = parseInt(item.dataset.index);
            insertFileReference(autocompleteData[index]);
          }
        });

        submitButton.addEventListener('click', () => {
          const input = document.getElementById('query');
          const chat = document.getElementById('chat');

          if (input.value.trim()) {
            const userMessage = input.value.trim();
            chat.innerHTML += \`<p><strong>You:</strong> \${userMessage}</p>\`;
            vscode.postMessage({ type: 'query', text: userMessage });
            input.value = '';
            hideAutocomplete();
          }
        });

        window.addEventListener('message', event => {
          const message = event.data;

          if (message.type === 'response') {
            const chat = document.getElementById('chat');
            chat.innerHTML += \`<p><strong>Vysor:</strong> \${message.text}</p>\`;
            chat.scrollTop = chat.scrollHeight;
          } else if (message.type === 'fileStructure') {
            autocompleteData = message.files;
          }
        });
        </script>
      </body>
      </html>
    `;
  }

  private getWorkspaceFileStructure(): Array<{ path: string; isDirectory: boolean }> {
    const files: Array<{ path: string; isDirectory: boolean }> = [];
    
    if (!vscode.workspace.workspaceFolders) {
      return files;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    
    try {
      this.scanDirectory(workspaceRoot, '', files);
    } catch (error) {
      console.error('Error scanning workspace:', error);
    }

    return files;
  }

  private scanDirectory(dirPath: string, relativePath: string, files: Array<{ path: string; isDirectory: boolean }>) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip node_modules, .git, and other common directories
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) {
        continue;
      }

      const currentRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        files.push({ path: currentRelativePath, isDirectory: true });
        // Recursively scan subdirectories, but limit depth to avoid performance issues
        if (relativePath.split('/').length < 3) {
          this.scanDirectory(path.join(dirPath, entry.name), currentRelativePath, files);
        }
      } else {
        // Only include common file types
        const ext = path.extname(entry.name).toLowerCase();
        if (['.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.txt', '.py', '.cpp', '.c', '.h', '.hpp'].includes(ext)) {
          files.push({ path: currentRelativePath, isDirectory: false });
        }
      }
    }
  }
}
