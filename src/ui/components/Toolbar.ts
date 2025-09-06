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
  private newChatButton!: Button;
  private historyButton!: Button;

  protected render(): void {
    const { title, onNewChat, onToggleHistory } = this.props;

    this.el.className = 'topbar';
    this.el.innerHTML = '';

    // History button + host (positioned wrapper) - LEFT SIDE
    const history = document.createElement('div');
    history.className = 'history'; // CSS gives this position: relative
    this.historyButton = new Button().mount(history, { label: 'History', onClick: onToggleHistory });
    this.el.appendChild(history);
    this.historyHost = history;

    // Title
    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = title || 'New chat';
    this.el.appendChild(t);

    // Spacer
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    this.el.appendChild(spacer);

    // New chat button - RIGHT SIDE
    this.newChatButton = new Button().mount(this.el, { label: 'New chat', onClick: onNewChat });

    // (Optional) Ellipsis menu placeholder — can be wired later if needed
    // const ellipsis = new Button().mount(this.el, { label: '…', kind: 'ghost', onClick: () => {/* open menu */} });
  }
}
