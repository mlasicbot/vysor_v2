"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebviewManager = void 0;
const vscode = __importStar(require("vscode"));
class WebviewManager {
    constructor(panel, extensionUri) {
        this.panel = panel;
        this.extensionUri = extensionUri;
    }
    update() {
        this.panel.webview.html = this.getHtmlForWebview();
    }
    getHtmlForWebview() {
        const webviewScriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'webview.js'));
        return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>Vysor Chat</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
              'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
              sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            margin: 0;
            padding: 0;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
          * {
            box-sizing: border-box;
          }
          #root {
            height: 100vh;
            display: flex;
            flex-direction: column;
          }
          .chat-app {
            display: flex;
            flex-direction: column;
            height: 100vh;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
          .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }
          .chat-input-container {
            display: flex;
            padding: 1rem;
            gap: 0.5rem;
            border-top: 1px solid var(--vscode-editor-lineHighlightBorder);
            background-color: var(--vscode-editor-background);
          }
          .chat-input {
            flex: 1;
            padding: 0.75rem;
            border: 1px solid var(--vscode-input-border);
            border-radius: 0.5rem;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 0.875rem;
            outline: none;
            transition: border-color 0.2s ease;
          }
          .chat-input:focus {
            border-color: var(--vscode-focusBorder);
          }
          .chat-input:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .send-button {
            padding: 0.75rem 1rem;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border);
            border-radius: 0.5rem;
            cursor: pointer;
            font-size: 1rem;
            transition: background-color 0.2s ease;
            min-width: 3rem;
          }
          .send-button:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
          }
          .send-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
        </style>
      </head>
      <body>
        <div id="root"></div>
        <script src="${webviewScriptUri}"></script>
      </body>
      </html>
    `;
    }
}
exports.WebviewManager = WebviewManager;
//# sourceMappingURL=WebviewManager.js.map