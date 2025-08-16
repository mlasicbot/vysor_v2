// src/ui/components/MessageBubble.ts
import { Component } from './Base';

export type MessageBubbleProps = {
  role: 'user' | 'assistant';
  label?: string;
  text: string;
  trace?: string[];
  /** Show a small "Copy" button for assistant messages */
  canCopy?: boolean;
  /** Custom copy handler (defaults to copying `text`) */
  onCopy?: () => void;
};

export class MessageBubble extends Component<MessageBubbleProps> {
  protected render(): void {
    const { role, label, text, trace, canCopy, onCopy } = this.props;

    this.el.className = `bubble ${role}`;
    this.el.innerHTML = '';
    this.el.setAttribute('data-role', role);

    if (label) {
      const m = document.createElement('div');
      m.className = 'meta';
      m.textContent = label;
      this.el.appendChild(m);
    }

    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = text; // If you later support markdown, swap this to a renderer.
    this.el.appendChild(body);

    if (trace?.length) {
      const tr = document.createElement('div');
      tr.className = 'trace';
      tr.textContent = trace.join('\n');
      this.el.appendChild(tr);
    }

    if (canCopy) {
      const b = document.createElement('button');
      b.className = 'btn ghost';
      b.type = 'button';
      b.textContent = 'Copy';
      b.ariaLabel = 'Copy message';
      b.addEventListener('click', () => {
        if (onCopy) {
          onCopy();
          return;
        }
        // Default copy behavior
        const toCopy = [text, ...(trace ?? [])].filter(Boolean).join('\n');
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(toCopy).catch(() => fallbackCopy(toCopy));
        } else {
          fallbackCopy(toCopy);
        }
      });
      this.el.appendChild(b);
    }
  }
}

/** Fallback copy using a temporary textarea (for older webview runtimes) */
function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', 'true');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  document.body.removeChild(ta);
}
