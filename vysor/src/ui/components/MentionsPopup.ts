// src/ui/components/MentionsPopup.ts
import { Component } from './Base';
import type { MentionItem } from '../types';

export class MentionsPopup extends Component<{
  open: boolean;
  items: MentionItem[];
  onPick: (i: MentionItem) => void;
}> {
  protected render(): void {
    this.el.className = 'mentions';
    this.el.innerHTML = '';

    // Toggle visibility; keep node mounted for stable layout/positioning
    this.el.style.display = this.props.open ? 'block' : 'none';
    if (!this.props.open) return;

    const items = this.props.items ?? [];
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'item';
      empty.style.opacity = '0.7';
      empty.textContent = 'No matches';
      this.el.appendChild(empty);
      return;
    }

    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'item';
      row.setAttribute('role', 'button');
      row.title = it.path; // handy on hover

      const name = document.createElement('div');
      name.textContent = it.name;

      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = it.kind;

      row.append(name, tag);
      row.onclick = () => this.props.onPick(it);
      this.el.appendChild(row);
    }
  }
}
