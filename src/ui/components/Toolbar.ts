// src/ui/components/Toolbar.ts
import { Component } from './Base';
import { Button } from './primitives/Button';
import { ModeSelector, VysorMode } from './ModeSelector';

export class Toolbar extends Component<{
  title: string;
  currentMode: VysorMode;
  onNewChat: () => void;
  onToggleHistory: () => void;
  onModeChange: (mode: VysorMode) => void;
}> {
  /** Mount the HistoryPanel into this element so absolute positioning works */
  public historyHost!: HTMLDivElement;
  private newChatButton!: Button;
  private historyButton!: Button;
  private modeSelector!: ModeSelector;

  protected render(): void {
    const { title, currentMode, onNewChat, onToggleHistory, onModeChange } = this.props;

    this.el.className = 'topbar';
    this.el.innerHTML = '';

    // History button + host (positioned wrapper) - LEFT SIDE
    const history = document.createElement('div');
    history.className = 'history';
    this.historyButton = new Button().mount(history, { label: '☰', kind: 'ghost', onClick: onToggleHistory });
    this.el.appendChild(history);
    this.historyHost = history;

    // Mode selector
    const modeHost = document.createElement('div');
    modeHost.className = 'toolbar-modes';
    this.modeSelector = new ModeSelector().mount(modeHost, {
      currentMode,
      onChange: onModeChange,
      disabled: false,
    });
    this.el.appendChild(modeHost);

    // Spacer
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    this.el.appendChild(spacer);

    // Title (smaller now)
    const t = document.createElement('div');
    t.className = 'title toolbar-title';
    t.textContent = title || 'New chat';
    t.title = title || 'New chat';
    this.el.appendChild(t);

    // New chat button - RIGHT SIDE
    this.newChatButton = new Button().mount(this.el, { 
      label: '+', 
      kind: 'ghost',
      onClick: onNewChat 
    });
  }
}
