// src/ui/components/HistoryPanel.ts
import { Component } from './Base';
import type { Session } from '../types';

export class HistoryPanel extends Component<{
  open: boolean;
  items: Session[];
  onPick: (id: string) => void;
}> {
  protected render(): void {
    this.el.className = 'history-panel';
    this.el.innerHTML = '';

    // Toggle visibility quickly; we still keep the node mounted so layout is stable.
    this.el.style.display = this.props.open ? 'block' : 'none';
    if (!this.props.open) return;

    if (!this.props.items?.length) {
      const empty = document.createElement('div');
      empty.className = 'history-item';
      empty.style.opacity = '0.7';
      empty.textContent = 'No chats yet';
      this.el.appendChild(empty);
      return;
    }

    this.props.items.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'history-item';
      row.textContent = s.title || 'Untitled chat';
      row.title = s.title || 'Untitled chat'; // tooltip shows full title if truncated
      row.onclick = () => this.props.onPick(s.id);
      this.el.appendChild(row);
    });
  }
}
