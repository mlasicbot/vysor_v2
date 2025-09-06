import type { WebviewOutbound, ExtensionInbound } from './types';

type VSCodeApi = {
  postMessage: (msg: any) => void;
  getState?: () => any;
  setState?: (s: any) => void;
};

const api: VSCodeApi = (() => {
  const w = window as any;
  // Prefer the instance created in ChatViewProvider HTML
  if (w.__vscode) return w.__vscode as VSCodeApi;
  // Fallback (shouldn’t happen if you set window.__vscode)
  if (typeof w.acquireVsCodeApi === 'function') return w.acquireVsCodeApi() as VSCodeApi;
  // No-op fallback for non-webview contexts
  return { postMessage: () => {} };
})();

export function send(msg: WebviewOutbound): void {
  try { api.postMessage(msg); } catch { /* no-op */ }
}

export function onMessage(handler: (m: ExtensionInbound) => void): () => void {
  const fn = (e: MessageEvent) => handler(e.data as ExtensionInbound);
  window.addEventListener('message', fn);
  return () => window.removeEventListener('message', fn);
}

export function saveState(key: string, value: unknown): void {
  try {
    const cur = api.getState?.() ?? {};
    api.setState?.({ ...cur, [key]: value });
  } catch { /* no-op */ }
}

export function loadState<T = unknown>(key: string): T | undefined {
  try {
    const cur = api.getState?.() ?? {};
    return cur[key] as T | undefined;
  } catch {
    return undefined;
  }
}
