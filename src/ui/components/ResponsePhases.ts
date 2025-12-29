// src/ui/components/ResponsePhases.ts
// Visual response phases during agent generation

import { Component } from './Base';

export type ResponsePhase = 'thinking' | 'executing' | 'reasoning' | 'final';

export interface PhaseItem {
  phase: ResponsePhase;
  label: string;
  content?: string;
  toolName?: string;
  isActive?: boolean;
  isComplete?: boolean;
}

export interface ResponsePhasesProps {
  phases: PhaseItem[];
  currentPhase: ResponsePhase;
  isGenerating: boolean;
}

const PHASE_CONFIG: Record<ResponsePhase, { icon: string; color: string; label: string }> = {
  thinking: {
    icon: '🧠',
    color: 'var(--vysor-phase-thinking)',
    label: 'Thinking',
  },
  executing: {
    icon: '⚡',
    color: 'var(--vysor-phase-executing)',
    label: 'Executing',
  },
  reasoning: {
    icon: '💭',
    color: 'var(--vysor-phase-reasoning)',
    label: 'Reasoning',
  },
  final: {
    icon: '✅',
    color: 'var(--vysor-phase-final)',
    label: 'Complete',
  },
};

export class ResponsePhases extends Component<ResponsePhasesProps> {
  protected render(): void {
    const { phases, currentPhase, isGenerating } = this.props;

    this.el.className = 'response-phases';
    this.el.innerHTML = '';

    // Phase timeline
    const timeline = document.createElement('div');
    timeline.className = 'phase-timeline';

    for (const phase of phases) {
      const config = PHASE_CONFIG[phase.phase];
      const item = document.createElement('div');
      item.className = `phase-item ${phase.phase}`;
      item.classList.toggle('active', phase.isActive || false);
      item.classList.toggle('complete', phase.isComplete || false);
      
      // Phase indicator
      const indicator = document.createElement('div');
      indicator.className = 'phase-indicator';
      indicator.style.setProperty('--phase-color', config.color);
      
      if (phase.isActive && isGenerating) {
        // Animated spinner for active phase
        indicator.innerHTML = `
          <div class="phase-spinner"></div>
        `;
      } else if (phase.isComplete) {
        indicator.innerHTML = `<span class="phase-check">✓</span>`;
      } else {
        indicator.innerHTML = `<span class="phase-icon">${config.icon}</span>`;
      }
      
      // Phase content
      const content = document.createElement('div');
      content.className = 'phase-content';
      
      const header = document.createElement('div');
      header.className = 'phase-header';
      header.innerHTML = `
        <span class="phase-label">${phase.label || config.label}</span>
        ${phase.toolName ? `<span class="phase-tool">${escapeHtml(phase.toolName)}</span>` : ''}
      `;
      content.appendChild(header);
      
      if (phase.content) {
        const text = document.createElement('div');
        text.className = 'phase-text';
        text.textContent = truncate(phase.content, 150);
        content.appendChild(text);
      }
      
      item.appendChild(indicator);
      item.appendChild(content);
      timeline.appendChild(item);
    }

    this.el.appendChild(timeline);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

// Inject styles
const STYLE_ID = 'vysor-response-phases-styles';
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .response-phases {
      padding: var(--vysor-space-3, 12px);
      background: var(--vysor-bg-raised, #161b22);
      border-radius: var(--vysor-radius-lg, 12px);
      border: 1px solid var(--vysor-border, #30363d);
    }
    
    .phase-timeline {
      display: flex;
      flex-direction: column;
      gap: var(--vysor-space-3, 12px);
    }
    
    .phase-item {
      display: flex;
      gap: var(--vysor-space-3, 12px);
      align-items: flex-start;
      opacity: 0.4;
      transition: all var(--vysor-transition-base, 0.2s);
    }
    
    .phase-item.active,
    .phase-item.complete {
      opacity: 1;
    }
    
    .phase-indicator {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: var(--phase-color, var(--vysor-accent));
      color: var(--vysor-bg, #0d1117);
      font-size: 14px;
      font-weight: 600;
    }
    
    .phase-item:not(.active):not(.complete) .phase-indicator {
      background: var(--vysor-bg-elevated, #1f2937);
      color: var(--vysor-fg-muted, #7d8590);
    }
    
    .phase-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid transparent;
      border-top-color: currentColor;
      border-radius: 50%;
      animation: vysor-spin 0.8s linear infinite;
    }
    
    .phase-check {
      font-size: 12px;
    }
    
    .phase-content {
      flex: 1;
      min-width: 0;
    }
    
    .phase-header {
      display: flex;
      align-items: center;
      gap: var(--vysor-space-2, 8px);
      margin-bottom: var(--vysor-space-1, 4px);
    }
    
    .phase-label {
      font-weight: 600;
      color: var(--vysor-fg, #e6edf3);
      font-size: var(--vysor-font-size-sm, 11px);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    
    .phase-item.active .phase-label {
      color: var(--phase-color, var(--vysor-accent));
    }
    
    .phase-tool {
      font-size: var(--vysor-font-size-xs, 10px);
      padding: 2px 6px;
      background: var(--vysor-bg, #0d1117);
      border-radius: var(--vysor-radius-sm, 4px);
      color: var(--vysor-accent);
      font-family: var(--vysor-font-sans);
    }
    
    .phase-text {
      font-size: var(--vysor-font-size-sm, 11px);
      color: var(--vysor-fg-muted, #7d8590);
      line-height: 1.4;
      word-break: break-word;
    }
    
    @keyframes vysor-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

