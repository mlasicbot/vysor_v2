// src/ui/components/Toolbar.ts
import { Component } from './Base';
import { Button } from './primitives/Button';

export class Toolbar extends Component<{
  title: string;
  onNewChat: () => void;
  onToggleHistory: () => void;
}> {
  /** Mount the HistoryPanel into this element so absolute positioning works */
  public historyHost!: HTMLDivElement;

  protected render(): void {
    const { title, onNewChat, onToggleHistory } = this.props;

    this.el.className = 'topbar';
    this.el.innerHTML = '';

    // New chat
    new Button().mount(this.el, { label: 'New chat', onClick: onNewChat });

    // Title
    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = title || 'New chat';
    this.el.appendChild(t);

    // Spacer
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    this.el.appendChild(spacer);

    // History button + host (positioned wrapper)
    const history = document.createElement('div');
    history.className = 'history'; // CSS gives this position: relative
    new Button().mount(history, { label: 'History', onClick: onToggleHistory });
    this.el.appendChild(history);
    this.historyHost = history;

    // Ellipsis menu (placeholder)
    new Button().mount(this.el, { label: '…', kind: 'ghost' });
  }
}
