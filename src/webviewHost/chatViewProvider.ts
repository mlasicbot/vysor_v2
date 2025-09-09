// © ASICBOT Private Limited Inc
// ChatViewProvider — VS Code side (Node) bridging the Webview and Orchestrator

import * as vscode from 'vscode';
import { Orchestrator } from '../core/orchestrator';

type MentionItem = { path: string; name: string; kind: 'file'|'dir' };
type Turn = { q: string; r: string; trace?: string[]; at: number };
type Session = { id: string; title: string; turns: Turn[]; createdAt: number; stickyContext?: string[] };

type WebviewMsg =
  | { type: 'UPLOAD/FILE'; name: string; mime: string; dataBase64: string; sessionId: string }
  | { type: 'CHAT/CLEAR_SESSION'; sessionId: string }
  | { type: 'UI/READY' }
  | { type: 'CHAT/SEND_PROMPT'; prompt: string; contextBlobs: string[]; sessionId: string; titleHint: string }
  | { type: 'CHAT/STOP'; runId: string }
  | { type: 'HISTORY/NEW_SESSION' }
  | { type: 'HISTORY/RENAME'; sessionId: string; title: string }
  | { type: 'HISTORY/DELETE_SESSION'; sessionId: string }
  | { type: 'MENTION/QUERY'; q: string }
  | { type: 'MENTION/LIST_DIR'; path: string }
  | { type: 'MENTION/READ_FILE'; path: string };

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vysor.chatView';

  private view?: vscode.WebviewView;
  private readonly HISTORY_KEY = 'vysor.chat.history';
  private fileIndex: string[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly orchestrator: Orchestrator,
    private readonly log?: { info: (...a:any[])=>void; error: (...a:any[])=>void }
  ) {}

  notifyConfigChanged(updated: unknown) {
    this.post({ type: 'CFG/UPDATED', payload: updated });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.log?.info?.('=== RESOLVE WEBVIEW VIEW CALLED ===');
    this.view = webviewView;
    const { webview } = webviewView;

    // Allow scripts and UI folders
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.joinPath(this.context.extensionUri, 'out', 'ui'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
      portMapping: [],
    };

    webview.html = this.html(webview);

    webview.onDidReceiveMessage((m: WebviewMsg) => this.onMessage(m));

    this.log?.info?.('=== WEBVIEW VIEW RESOLVED SUCCESSFULLY ===');
  }

  // ---------- inbound from UI ----------
  private async onMessage(msg: WebviewMsg) {
    try {
      switch (msg.type) {
        case 'UI/READY':              return this.postHistory();
        case 'HISTORY/NEW_SESSION':   await this.createSession(); return this.postHistory();
        case 'HISTORY/RENAME':        await this.renameSession(msg.sessionId, msg.title); return this.postHistory();
        case 'HISTORY/DELETE_SESSION':await this.deleteSession(msg.sessionId); return this.postHistory();

        case 'CHAT/SEND_PROMPT':
          return this.runChat(msg.sessionId, msg.prompt, msg.contextBlobs, msg.titleHint);

        case 'CHAT/STOP':
          this.orchestrator.stopGeneration(); return;

        case 'UPLOAD/FILE': {
          return this.handleUploadFile(msg.sessionId, msg.name, msg.mime, msg.dataBase64);
        }
        case 'MENTION/QUERY':       return this.mentionQuery(msg.q);
        case 'MENTION/LIST_DIR':    return this.listDir(msg.path);
        case 'MENTION/READ_FILE':   return this.readFile(msg.path);
        case 'CHAT/CLEAR_SESSION': {
          const h = this.getHistory();
          const i = h.findIndex(s => s.id === msg.sessionId);
          if (i >= 0) {
            h[i].turns = [];                     // clear turns
            await this.saveHistory(h);           // persist
          }
          return this.postHistory();             // push back to UI
        };
      }
    } catch (e:any) {
      this.log?.error?.('onMessage error', e);
      this.post({ type: 'CHAT/ERROR', message: String(e?.message || e) });
    }
  }
  
  // ---------- chat run ----------
  private async runChat(sessionId: string, prompt: string, blobs: string[], titleHint: string) {
    const runId = this.id();
    this.post({ type: 'CHAT/STREAM_START', runId, sessionId });

    const history = this.getHistory();
    const session = history.find(s => s.id === sessionId) ?? this.ensureSession(history);
    const previous = session.turns.map(t => `Q: ${t.q}\nR: ${t.r}`).join('\n\n');

    const blobSet = new Set<string>((blobs || []).map(b => b.trim()));
    const dedupBlobs = [...blobSet];

    const context = [previous, ...dedupBlobs].filter(Boolean).join('\n\n');

    const trace: string[] = [];
    const onProgress = (text: string) => {
      // Suppress heavy/structured blocks & Tool Args from the live bubble
      const suppressLive =
        /^\s*##\s*Hop Context\b/i.test(text) ||
        /<<<HOP\b/.test(text) ||
        /^\s*##\s*Tool Args\b/i.test(text);
      if (!suppressLive) {
        this.post({ type: 'CHAT/STREAM_DELTA', runId, text });
      }
      this.post({ type:'TRACE/ENTRY', runId, entry: text });
      trace.push(text);
    };

    let finalText = '';
    let wasStopped = false;

    try {
      finalText = await this.orchestrator.processQuery(
        { query: prompt, context },
        onProgress
      );
    } catch (e:any) {
      const msg = String(e?.message || e);
      if (/cancelled|canceled|Request cancelled/i.test(msg)) {
        wasStopped = true;
        this.post({ type:'CHAT/STREAM_END', runId, ok:false, stopped:true });
        return;
      }
      this.post({ type:'CHAT/ERROR', runId, message: msg });
      return;
    } finally {
      if (!wasStopped) {
        session.turns.push({ q: prompt, r: finalText, trace, at: Date.now() });
        if (session.turns.length === 1 && titleHint) session.title = titleHint;
        await this.saveHistory(history);
        this.post({ type:'CHAT/STREAM_END', runId, ok:true });
        this.postHistory();
      }
    }
  }

  // ---------- history ----------
  private getHistory(): Session[] { return (this.context.globalState.get(this.HISTORY_KEY) as Session[]) || []; }
  private async saveHistory(h: Session[]) { await this.context.globalState.update(this.HISTORY_KEY, h); }
  private async postHistory(){ const h = this.getHistory(); this.post({ type:'HISTORY/LOAD_OK', history: h, focus: h[0]?.id }); }

  private async createSession(){
    const h = this.getHistory();
    const s: Session = { id: this.id(), title: 'New chat', turns: [], createdAt: Date.now(), stickyContext: [] };
    h.unshift(s);
    await this.saveHistory(h);
  }
  private async renameSession(id:string, title:string){ const h=this.getHistory(); const i=h.findIndex(s=>s.id===id); if(i>=0) h[i].title=title; await this.saveHistory(h); }
  private async deleteSession(id:string){ await this.saveHistory(this.getHistory().filter(s=>s.id!==id)); }
  private ensureSession(h: Session[]): Session {
    if (!h.length) {
      const s: Session = {
        id: this.id(),
        title: 'New chat',
        turns: [],
        createdAt: Date.now(),
        stickyContext: [],
      };
      h.unshift(s);
      return s;
    }
    return h[0];
  }

  // ---------- mentions ----------
  private async mentionQuery(q: string) {
    if (!this.fileIndex.length) {
      const uris = await vscode.workspace.findFiles('**/*', '{**/.git/**,**/node_modules/**,**/.venv/**,**/dist/**,**/out/**}', 7000);
      this.fileIndex = uris.map(u=>u.fsPath);
    }
    const qq = (q||'').toLowerCase();
    const items = this.fileIndex.map(p => ({ path:p, name: p.split(/[/\\]/).pop()||p, kind:'file' as const }));
    const ranked = items
      .map(it=>({ it, s: !qq?0 : it.name.toLowerCase().startsWith(qq)? 1000-it.name.length : it.name.toLowerCase().includes(qq)? 500-it.name.length : -it.name.length }))
      .sort((a,b)=>b.s-a.s).slice(0,40).map(x=>x.it);
    this.post({ type:'MENTION/RESULTS', items: ranked });
  }

  private async listDir(abs: string) {
    const base = vscode.Uri.file(abs);
    const entries = await vscode.workspace.fs.readDirectory(base);
    const out: MentionItem[] = entries.map(([name, k]) => ({ path: vscode.Uri.joinPath(base, name).fsPath, name, kind: k===vscode.FileType.Directory?'dir':'file' }));
    this.post({ type:'MENTION/DIR_CONTENTS', base: abs, items: out });
  }
  
  private async readFile(abs: string) {
    const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
    const text = new TextDecoder('utf-8').decode(buf);

    const codeBlock = [
      `<<<CODE path="${abs.replace(/"/g,'\\"')}">>>`,
      text,
      `<<<END CODE>>>`
    ].join('\n');

    this.post({ type:'MENTION/FILE_CONTENT', path: abs, content: codeBlock });
  }

  // ---------- HTML ----------
  private html(webview: vscode.Webview) {
    const nonce = Math.random().toString(36).slice(2);

    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'ui', 'styles', 'main.css')
    );
    const js  = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'ui', 'app.js')   // ← esbuild output
    );

    this.log?.info?.('HTML resources resolved', { css: css.toString(), js: js.toString() });
    this.log?.info?.('=== GENERATING HTML ===');

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`
    ].join('; ');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${css}">
  <title>Vysor</title>
</head>
<body>
  <div id="root">Loading Vysor…</div>
  <script nonce="${nonce}">window.__vscode = acquireVsCodeApi();</script>
  <script nonce="${nonce}">
    console.log('=== HTML LOADED ===');
    console.log('VSCode API acquired:', typeof window.__vscode);
    console.log('Document ready state:', document.readyState);
  </script>
  <!-- IMPORTANT: load bundled ESM -->
  <script nonce="${nonce}" type="module" src="${js}"></script>
  <script nonce="${nonce}">
    console.log('=== AFTER JS LOAD ===');
    console.log('Root element:', document.getElementById('root'));
  </script>
</body>
</html>`;
  }

  // ---------- utils ----------
  private post(o:any){ this.view?.webview.postMessage(o); }
  private id(){ return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }

  private async handleUploadFile(sessionId: string, name: string, mime: string, dataBase64: string) {
    const startedAt = Date.now();
    const baseUrl = 'http://127.0.0.1:8889';
    const useRaw = false;
    const apiUrl = `${baseUrl}${useRaw ? '/ocr/raw' : '/ocr'}`;

    try {
      this.post({ type: 'UPLOAD/START', fileName: name, sessionId });
      this.log?.info?.('[OCR] start', { sessionId, name, mime, baseUrl, apiUrl });

      // quick env probe
      // @ts-ignore
      const envProbe = { hasFetch: !!globalThis.fetch, hasFormData: !!globalThis.FormData, hasBlob: !!globalThis.Blob };
      this.log?.info?.('[OCR] env', envProbe);

      // health check
      try {
        const h = await fetch(`${baseUrl}/health`, { method: 'GET' });
        this.log?.info?.('[OCR] health', { ok: h.ok, status: h.status });
      } catch (e) {
        this.log?.error?.('[OCR] health check failed', e);
      }

      // build form
      const bin = Buffer.from(dataBase64, 'base64');
      const form = new FormData();
      const blob = new Blob([bin], { type: mime || 'application/octet-stream' });
      form.append('file', blob, name);
      this.log?.info?.('[OCR] form built', { bytes: bin.byteLength });

      // POST
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 600_000); // 10 min
      let res: Response;
      try {
        res = await fetch(apiUrl, { method: 'POST', body: form as any, signal: controller.signal });
      } finally {
        clearTimeout(t);
      }

      const headersObj: Record<string, string> = {};
      res.headers.forEach((v, k) => { headersObj[k] = v; });
      this.log?.info?.('[OCR] response', { ok: res.ok, status: res.status, headers: headersObj });

      const raw = await res.text();
      this.log?.info?.('[OCR] raw-length', { len: raw.length });
      this.log?.info?.('[OCR] raw-preview', raw.slice(0, 300));

      if (!res.ok) throw new Error(`OCR failed (${res.status})`);

      // parse or pass-through
      let markdown: string;
      try {
        const parsed = raw ? JSON.parse(raw) as { markdown?: unknown } : {};
        markdown = (parsed && typeof parsed.markdown === 'string') ? parsed.markdown : raw;
      } catch {
        markdown = raw;
      }

      // persist as stickyContext (history only)
      const h = this.getHistory();
      const s = h.find(x => x.id === sessionId) ?? this.ensureSession(h);
      s.stickyContext = s.stickyContext ?? [];

      const docBlock = [
        `<<<DOC name="${name.replace(/"/g,'\\"')}" mime="${mime || 'application/octet-stream'}">>>`,
        markdown,
        `<<<END DOC>>>`
      ].join('\n');

      s.stickyContext!.push(docBlock);
      await this.saveHistory(h);
      this.log?.info?.('[OCR] stickyContext appended', { sessionId, addBytes: markdown.length, elapsedMs: Date.now() - startedAt });

      // notify UI
      this.post({ type: 'UPLOAD/SUCCESS', fileName: name, sessionId });
      this.post({ type: 'MENTION/FILE_CONTENT', path: `ATTACH:${name}`, content: markdown, mime });

    } catch (e: any) {
      this.log?.error?.('[OCR] error', { message: String(e?.message || e), elapsedMs: Date.now() - startedAt });
      this.post({ type: 'UPLOAD/ERROR', fileName: name, sessionId, message: String(e?.message || e) });
      this.post({ type: 'CHAT/ERROR', message: `Attach/OCR error: ${String(e?.message || e)}` });
    }
  }
}
