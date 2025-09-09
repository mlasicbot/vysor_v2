// src/ui/components/MessageBubble.ts
import { Component } from './Base';

export type HopView = { index: number; thought?: string; tool?: string; output?: string };

export type MessageBubbleProps = {
  role: 'user' | 'assistant';
  label?: string;
  text: string;
  trace?: string[];
  canCopy?: boolean;
  onCopy?: () => void;
  generating?: boolean;
};

export class MessageBubble extends Component<MessageBubbleProps> {
  private traceExpanded = false;

  protected render(): void {
    const { role, label, text, trace, canCopy, onCopy, generating } = this.props;

    this.el.className = `bubble ${role}${generating ? ' generating' : ''}`;
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

    if (role === 'assistant') {
      if (generating) {
        // --- MINI HUD during generation: latest Thought + Selected Tool + Result
        const hud = document.createElement('div');
        hud.className = 'mini-hud';

        const { thought, tool, exec } = this.summarizeLive(trace || []);
        if (thought) {
          const line = document.createElement('div');
          line.className = 'mini-hud-line';
          line.innerHTML = `<span class="mini-hud-label">Thought</span><span class="mini-hud-text">${escapeHtml(thought)}</span>`;
          hud.appendChild(line);
        }
        if (tool) {
          const line = document.createElement('div');
          line.className = 'mini-hud-line';
          line.innerHTML = `<span class="mini-hud-label">Tool</span><span class="mini-hud-text">${escapeHtml(tool)}</span>`;
          hud.appendChild(line);
        }
        if (exec) {
          const line = document.createElement('div');
          line.className = 'mini-hud-line';
          line.innerHTML = `<span class="mini-hud-label">Result</span><span class="mini-hud-text">${escapeHtml(exec)}</span>`;
          hud.appendChild(line);
        }

        // Status row
        const status = document.createElement('div');
        status.className = 'generating-indicator';
        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        const stepText = document.createElement('div');
        stepText.className = 'step-text';
        stepText.textContent = this.getCurrentStep(trace);
        status.appendChild(spinner);
        status.appendChild(stepText);

        body.appendChild(hud);
        body.appendChild(status);
      } else {
        // --- FINAL: show only the assistant's final text (simple/final answer)
        body.textContent = text || '';
      }
    } else {
      // user bubble
      body.textContent = text || '';
    }

    this.el.appendChild(body);

    // Details toggle appears only for assistant messages that have any trace
    if (role === 'assistant' && (this.props.trace?.length ?? 0) > 0) {
      const toggle = document.createElement('button');
      toggle.className = 'btn ghost expand-btn';
      toggle.textContent = this.traceExpanded ? 'Hide details' : 'Show details';
      toggle.onclick = () => { this.traceExpanded = !this.traceExpanded; this.render(); };
      this.el.appendChild(toggle);

      if (this.traceExpanded) {
        // Expanded: hops with Thought / Tool Selected / Tool Execution Result (no Tool Args).
        const hops = this.toHops(this.props.trace!);
        for (const h of hops) {
          const box = document.createElement('details');
          box.className = 'hop-box';
          box.open = false;

          const sum = document.createElement('summary');
          sum.className = 'hop-title';
          sum.textContent = `Hop ${h.index}`;
          box.appendChild(sum);

          const cont = document.createElement('div');
          cont.className = 'hop-content';

          if (h.thought) {
            const hd = document.createElement('h4'); hd.textContent = 'Thought'; cont.appendChild(hd);
            const pre = document.createElement('pre'); pre.textContent = h.thought; cont.appendChild(pre);
          }
          if (h.tool) {
            const hd = document.createElement('h4'); hd.textContent = 'Tool Selected'; cont.appendChild(hd);
            const pre = document.createElement('pre'); pre.textContent = h.tool; cont.appendChild(pre);
          }
          if (h.output) {
            const hd = document.createElement('h4'); hd.textContent = 'Tool Execution Result'; cont.appendChild(hd);
            const pre = document.createElement('pre'); pre.textContent = h.output; cont.appendChild(pre);
          }

          box.appendChild(cont);
          this.el.appendChild(box);
        }
      }
    }

    if (canCopy) {
      const b = document.createElement('button');
      b.className = 'btn ghost';
      b.type = 'button';
      b.textContent = 'Copy';
      b.ariaLabel = 'Copy message';
      b.addEventListener('click', () => {
        if (onCopy) { onCopy(); return; }
        const toCopy = this.props.text || '';
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(toCopy).catch(() => fallbackCopy(toCopy));
        } else {
          fallbackCopy(toCopy);
        }
      });
      this.el.appendChild(b);
    }
  }

  // ---------- helpers ----------

  // Hide bulky bodies from DOC/CODE blocks when rendering details
  private stripTypedBlockContent(s: string): string {
    s = s.replace(/<<<DOC[^>]*>>[\s\S]*?<<<END DOC>>>/g, (m) => {
      const head = m.match(/<<<DOC[^>]*>>/)?.[0] ?? '<<<DOC>>>';
      return `${head} [hidden] <<<END DOC>>>`;
    });
    s = s.replace(/<<<CODE[^>]*>>[\s\S]*?<<<END CODE>>>/g, (m) => {
      const head = m.match(/<<<CODE[^>]*>>/)?.[0] ?? '<<<CODE>>>';
      return `${head} [hidden] <<<END CODE>>>`;
    });
    return s;
  }

  private toHops(trace: string[]): HopView[] {
    const hops: HopView[] = [];
    let cur: HopView | null = null;

    const hasContent = (h?: HopView | null) =>
      !!h && (Boolean(h.thought) || Boolean(h.tool) || Boolean(h.output));

    const pushIfContent = () => {
      if (hasContent(cur)) hops.push(cur as HopView);
    };

    for (const raw of trace) {
      const s = this.stripTypedBlockContent(raw || '');

      if (s.includes('<<<HOP')) {
        // If we hit another HOP tag and the current hop is still empty,
        // treat this as a duplicate header and ignore it.
        if (cur && !hasContent(cur)) {
          continue;
        }
        // Otherwise, finish the previous hop (if it had content) and start a new one.
        pushIfContent();
        cur = { index: (hops.length + 1) };
        continue;
      }

      const thought = s.match(/^##\s*Thought[^\n]*\n([\s\S]*)$/);
      if (thought) { (cur ??= { index: (hops.length + 1) }).thought = thought[1].trim(); continue; }

      const tool = s.match(/^##\s*Selected Tool[^\n]*\n([\s\S]*)$/);
      if (tool) { (cur ??= { index: (hops.length + 1) }).tool = tool[1].trim(); continue; }

      // We intentionally map "Execution Result" to the UI field "output",
      // because expanded view should show the VS Code execution result.
      const out  = s.match(/^##\s*Execution Result[^\n]*\n([\s\S]*)$/);
      if (out)  { (cur ??= { index: (hops.length + 1) }).output = out[1].trim(); continue; }

      // Intentionally ignore "## Tool Args" here.
    }

    // Push the last hop only if it carries any content
    pushIfContent();
    return hops;
  }

  private summarizeLive(trace: string[]): { thought?: string; tool?: string; exec?: string } {
    let thought: string | undefined;
    let tool: string | undefined;
    let exec: string | undefined;
    for (let i = trace.length - 1; i >= 0; i--) {
      const line = trace[i] || '';
      if (!tool && /^##\s*Selected Tool/i.test(line)) {
        const next = trace[i + 1]?.trim();
        tool = (next && !next.startsWith('##')) ? next : line.replace(/^##\s*Selected Tool\s*/i, '').trim();
      }
      if (!thought && /^##\s*Thought/i.test(line)) {
        const next = trace[i + 1]?.trim();
        thought = (next && !next.startsWith('##')) ? next : line.replace(/^##\s*Thought.*?/i, '').trim();
      }
      if (!exec && /^##\s*Execution Result/i.test(line)) {
        const next = trace[i + 1]?.trim();
        exec = (next && !next.startsWith('##')) ? next : line.replace(/^##\s*Execution Result\s*/i, '').trim();
      }
      if (thought && tool && exec) break;
    }
    return { thought, tool, exec };
  }

  private getCurrentStep(trace?: string[]): string {
    if (!trace?.length) return 'Thinking...';
    const last = trace[trace.length - 1];

    if (last.includes('## Thought')) {
      const m = last.match(/## Thought #(\d+)/);
      return m ? `Thinking (Step ${m[1]})...` : 'Thinking...';
    }
    if (last.includes('## Selected Tool')) return 'Selecting Tool...';
    if (last.includes('## Tool Args')) return 'Preparing Tool Arguments...';
    if (last.includes('## Execution Result')) return 'Executing Tool...';
    if (last.includes('## Final')) return 'Finalizing Response...';
    return 'Processing...';
  }
}

/** Escape for inline HTML use */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
