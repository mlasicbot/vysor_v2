// src/ui/components/MessageList.ts
import { Component } from './Base';
import { MessageBubble } from './MessageBubble';
import type { MessageBubbleProps } from './MessageBubble';

export class MessageList extends Component<{ items: MessageBubbleProps[] }> {
  protected render(): void {
    this.el.className = 'messages';
    // a11y: announce new messages without stealing focus
    this.el.setAttribute('role', 'log');
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-relevant', 'additions');
    this.el.setAttribute('aria-atomic', 'false');

    const items = this.props.items ?? [];

    // Should we stick to bottom after render?
    const nearBottom =
      this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 24;

    // Rebuild content efficiently
    this.el.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const p of items) {
      new MessageBubble().mount(frag as unknown as HTMLElement, p); // mount accepts HTMLElement; DocumentFragment works for appendChild
    }
    this.el.appendChild(frag);

    // Auto-scroll only if user was already at bottom (or list is short)
    if (nearBottom || items.length <= 2) {
      this.el.scrollTop = this.el.scrollHeight;
    }
  }
}
