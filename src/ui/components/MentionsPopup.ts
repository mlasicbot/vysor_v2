// src/ui/components/MentionsPopup.ts
import { Component } from './Base';
import type { MentionItem } from '../types';

export class MentionsPopup extends Component<{
  open: boolean;
  items: MentionItem[];
  onPick: (item: MentionItem) => void;
}> {
  private highlighted = 0;

  protected render(): void {
    this.el.className = 'mentions';
    this.el.innerHTML = '';

    // Visibility
    if (!this.props.open || !this.props.items?.length) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = 'block';

    // Reset highlight if out of range
    if (this.highlighted >= this.props.items.length) this.highlighted = 0;

    // List
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'File mentions');
    this.el.appendChild(list);

    this.props.items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'item';
      row.setAttribute('role', 'option');
      row.setAttribute('tabindex', '-1');

      if (idx === this.highlighted) {
        row.style.outline = '1px solid var(--accent)';
        row.style.borderRadius = '6px';
      }

      const name = document.createElement('div');
      name.textContent = it.name;
      name.style.overflow = 'hidden';
      name.style.textOverflow = 'ellipsis';

      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = it.kind === 'dir' ? 'DIR' : 'FILE';

      row.appendChild(name);
      row.appendChild(tag);

      row.onclick = (e) => {
        e.preventDefault();
        this.props.onPick(it);
      };

      row.onmouseenter = () => {
        this.highlighted = idx;
        // re-render only the focus outline cheaply
        Array.from(list.children).forEach((c, i) => {
          const el = c as HTMLElement;
          if (i === this.highlighted) {
            el.style.outline = '1px solid var(--accent)';
            el.style.borderRadius = '6px';
          } else {
            el.style.outline = 'none';
          }
        });
      };

      list.appendChild(row);
    });

    // Keyboard navigation
    this.el.onkeydown = (ev: KeyboardEvent) => {
      if (!this.props.open) return;

      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        this.highlighted = (this.highlighted + 1) % this.props.items.length;
        this.update(this.props);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        this.highlighted =
          (this.highlighted - 1 + this.props.items.length) % this.props.items.length;
        this.update(this.props);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        const it = this.props.items[this.highlighted];
        if (it) this.props.onPick(it);
      } else if (ev.key === 'Escape') {
        // Let the parent handle closing via its own logic
        // (Composer listens for Escape to close mentions)
      }
    };

    // Ensure the popup can receive keyboard events
    (this.el as HTMLElement).tabIndex = -1;
    setTimeout(() => (this.el as HTMLElement).focus(), 0);
  }
}
