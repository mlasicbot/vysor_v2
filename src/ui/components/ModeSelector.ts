// src/ui/components/ModeSelector.ts
// Mode selector for Vysor: Agent | Plan | Debug | Ask

import { Component } from './Base';

export type VysorMode = 'agent' | 'plan' | 'debug' | 'ask';

export interface ModeSelectorProps {
  currentMode: VysorMode;
  onChange: (mode: VysorMode) => void;
  disabled?: boolean;
}

const MODE_CONFIG: Record<VysorMode, { icon: string; label: string; description: string; color: string }> = {
  agent: {
    icon: '🤖',
    label: 'Agent',
    description: 'Execute tasks with tools',
    color: 'var(--vysor-accent)',
  },
  plan: {
    icon: '📋',
    label: 'Plan',
    description: 'Generate implementation plans',
    color: 'var(--vysor-phase-thinking)',
  },
  debug: {
    icon: '🐛',
    label: 'Debug',
    description: 'Analyze and fix issues',
    color: 'var(--vysor-error)',
  },
  ask: {
    icon: '💬',
    label: 'Ask',
    description: 'Answer questions (read-only)',
    color: 'var(--vysor-info)',
  },
};

export class ModeSelector extends Component<ModeSelectorProps> {
  protected render(): void {
    const { currentMode, disabled } = this.props;

    this.el.className = 'mode-selector';
    this.el.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'mode-buttons';

    for (const mode of Object.keys(MODE_CONFIG) as VysorMode[]) {
      const config = MODE_CONFIG[mode];
      const btn = document.createElement('button');
      btn.className = `mode-btn ${mode === currentMode ? 'active' : ''}`;
      btn.disabled = disabled || false;
      btn.setAttribute('data-mode', mode);
      btn.title = config.description;
      
      btn.innerHTML = `
        <span class="mode-icon">${config.icon}</span>
        <span class="mode-label">${config.label}</span>
      `;

      btn.style.setProperty('--mode-color', config.color);
      
      btn.addEventListener('click', () => {
        if (!disabled && this.props.onChange) {
          this.props.onChange(mode);
        }
      });

      container.appendChild(btn);
    }

    this.el.appendChild(container);
  }
}

// Styles for ModeSelector (injected once)
const STYLE_ID = 'vysor-mode-selector-styles';
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .mode-selector {
      display: flex;
      align-items: center;
      gap: var(--vysor-space-2, 8px);
    }
    
    .mode-buttons {
      display: flex;
      background: var(--vysor-bg-raised, #161b22);
      border: 1px solid var(--vysor-border, #30363d);
      border-radius: var(--vysor-radius-lg, 12px);
      padding: 2px;
      gap: 2px;
    }
    
    .mode-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: transparent;
      border: none;
      border-radius: var(--vysor-radius-md, 8px);
      color: var(--vysor-fg-muted, #7d8590);
      font-family: inherit;
      font-size: var(--vysor-font-size-sm, 11px);
      font-weight: 500;
      cursor: pointer;
      transition: all var(--vysor-transition-fast, 0.1s);
    }
    
    .mode-btn:hover:not(:disabled) {
      background: var(--vysor-bg-elevated, #1f2937);
      color: var(--vysor-fg, #e6edf3);
    }
    
    .mode-btn.active {
      background: var(--mode-color);
      color: var(--vysor-bg, #0d1117);
      font-weight: 600;
    }
    
    .mode-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .mode-icon {
      font-size: 14px;
    }
    
    .mode-label {
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    
    @media (max-width: 400px) {
      .mode-label {
        display: none;
      }
      
      .mode-btn {
        padding: 8px;
      }
    }
  `;
  document.head.appendChild(style);
}

