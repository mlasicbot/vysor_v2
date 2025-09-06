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
  /** Whether this message is currently being generated */
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
    
    // For assistant messages, show only the final answer by default
    if (role === 'assistant' && trace?.length) {
      // Extract the final answer (last line that doesn't start with ##)
      const finalAnswer = this.extractFinalAnswer(text, trace);
      body.textContent = finalAnswer;
      
      // Add expandable trace section
      const traceSection = document.createElement('div');
      traceSection.className = 'trace-section';
      
      const expandButton = document.createElement('button');
      expandButton.className = 'btn ghost expand-btn';
      expandButton.type = 'button';
      expandButton.textContent = this.traceExpanded ? 'Hide Details' : 'Show Details';
      expandButton.addEventListener('click', () => {
        this.traceExpanded = !this.traceExpanded;
        this.render();
      });
      
      traceSection.appendChild(expandButton);
      
      if (this.traceExpanded) {
        const traceContent = document.createElement('div');
        traceContent.className = 'trace-content';
        
        // Show the full trace with proper formatting
        const fullTrace = this.formatTrace(text, trace);
        traceContent.innerHTML = fullTrace;
        
        traceSection.appendChild(traceContent);
      }
      
      this.el.appendChild(traceSection);
    } else {
      body.textContent = text;
    }
    
    this.el.appendChild(body);

    // Add generating indicator for assistant messages
    if (role === 'assistant' && generating) {
      const generatingIndicator = document.createElement('div');
      generatingIndicator.className = 'generating-indicator';
      
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      
      const stepText = document.createElement('div');
      stepText.className = 'step-text';
      stepText.textContent = this.getCurrentStep(trace);
      
      generatingIndicator.appendChild(spinner);
      generatingIndicator.appendChild(stepText);
      this.el.appendChild(generatingIndicator);
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

  private getCurrentStep(trace?: string[]): string {
    if (!trace || trace.length === 0) return 'Thinking...';
    
    const lastTrace = trace[trace.length - 1];
    
    // Check for specific step indicators
    if (lastTrace.includes('## Thought')) {
      const thoughtMatch = lastTrace.match(/## Thought #(\d+)/);
      if (thoughtMatch) {
        return `Thinking (Step ${thoughtMatch[1]})...`;
      }
      return 'Thinking...';
    }
    
    if (lastTrace.includes('## Selected Tool')) {
      const toolMatch = lastTrace.match(/## Selected Tool\s*\n([^\n]+)/);
      if (toolMatch) {
        return `Selected Tool: ${toolMatch[1].trim()}`;
      }
      return 'Selecting Tool...';
    }
    
    if (lastTrace.includes('## Tool Args')) {
      return 'Preparing Tool Arguments...';
    }
    
    if (lastTrace.includes('## Execution Result')) {
      return 'Executing Tool...';
    }
    
    if (lastTrace.includes('## Final')) {
      return 'Finalizing Response...';
    }
    
    // Check for tool events
    if (lastTrace.includes('TOOL:')) {
      return 'Tool Event...';
    }
    
    // Check for general processing
    if (lastTrace.includes('{') && lastTrace.includes('}')) {
      return 'Processing Data...';
    }
    
    return 'Processing...';
  }

  private extractFinalAnswer(text: string, trace: string[]): string {
    // Look for the final answer in the trace
    // Usually it's the last meaningful content after all the ## sections
    const fullContent = [text, ...trace].join('\n');
    
    // Split by lines and find the last non-header line
    const lines = fullContent.split('\n');
    let finalAnswer = '';
    
    // Look for the last meaningful response that's not a system message
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line && 
          !line.startsWith('##') && 
          !line.startsWith('Thought') && 
          !line.startsWith('Selected Tool') && 
          !line.startsWith('Tool Args') && 
          !line.startsWith('Execution Result') && 
          !line.startsWith('Final') &&
          !line.includes('{') && // Skip JSON objects
          !line.includes('}') &&
          line.length > 3) { // Skip very short lines
        finalAnswer = line;
        break;
      }
    }
    
    // If no final answer found in trace, try to extract from the original text
    if (!finalAnswer) {
      // Look for the last non-empty line in the original text
      const textLines = text.split('\n').filter(line => line.trim().length > 0);
      if (textLines.length > 0) {
        const lastTextLine = textLines[textLines.length - 1].trim();
        if (lastTextLine && !lastTextLine.startsWith('##')) {
          finalAnswer = lastTextLine;
        }
      }
    }
    
    // If still no final answer, return a default message
    return finalAnswer || 'Response generated successfully.';
  }

  private formatTrace(text: string, trace: string[]): string {
    // Format the trace with proper markdown-like styling
    const fullContent = [text, ...trace].join('\n');
    const lines = fullContent.split('\n');
    
    return lines.map(line => {
      if (line.startsWith('##')) {
        return `<div class="trace-header">${line}</div>`;
      } else if (line.trim()) {
        return `<div class="trace-line">${line}</div>`;
      } else {
        return '<br>';
      }
    }).join('');
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
