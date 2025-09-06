// src/ui/components/MessageList.ts
import { Component } from './Base';
import { MessageBubble } from './MessageBubble';
import type { MessageBubbleProps } from './MessageBubble';

export class MessageList extends Component<{ 
  items: MessageBubbleProps[];
  generating?: boolean;
}> {
  private lastItemCount = 0;
  private userScrolled = false;
  private messageBubbles: MessageBubble[] = [];

  protected render(): void {
    this.el.className = 'messages';
    // a11y: announce new messages without stealing focus
    this.el.setAttribute('role', 'log');
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-relevant', 'additions');
    this.el.setAttribute('aria-atomic', 'false');

    const items = this.props.items ?? [];
    const currentItemCount = items.length;

    // Track if user has manually scrolled
    this.el.addEventListener('scroll', () => {
      const nearBottom = this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 24;
      this.userScrolled = !nearBottom;
    });

    // Should we stick to bottom after render?
    const nearBottom =
      this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 24;

    // Clear existing content
    this.el.innerHTML = '';
    
    // Update or create message bubbles efficiently
    const frag = document.createDocumentFragment();
    const newMessageBubbles: MessageBubble[] = [];
    
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      const isGenerating = this.props.generating && 
                          p.role === 'assistant' && 
                          i === items.length - 1;
      
      // Try to reuse existing message bubble if possible
      let bubble: MessageBubble;
      if (i < this.messageBubbles.length && 
          this.messageBubbles[i] && 
          this.messageBubbles[i].props.role === p.role &&
          this.messageBubbles[i].props.label === p.label) {
        // Reuse existing bubble and update it
        bubble = this.messageBubbles[i];
        bubble.update({
          ...p,
          generating: isGenerating
        });
        // Move the existing element to the fragment
        frag.appendChild(bubble.el);
      } else {
        // Create new bubble
        bubble = new MessageBubble();
        bubble.mount(frag as unknown as HTMLElement, {
          ...p,
          generating: isGenerating
        });
      }
      
      newMessageBubbles.push(bubble);
    }
    
    // Clean up unused message bubbles
    this.messageBubbles.forEach(bubble => {
      if (!newMessageBubbles.includes(bubble)) {
        bubble.destroy();
      }
    });
    
    // Update our stored bubbles
    this.messageBubbles = newMessageBubbles;
    
    this.el.appendChild(frag);

    // Auto-scroll logic:
    // 1. Always scroll to bottom for new messages (when item count increases)
    // 2. Only auto-scroll during generation if user was already at bottom
    // 3. Don't auto-scroll if user has manually scrolled up
    const hasNewMessages = currentItemCount > this.lastItemCount;
    const shouldAutoScroll = hasNewMessages || 
                           (nearBottom && !this.userScrolled) || 
                           items.length <= 2;

    if (shouldAutoScroll) {
      this.el.scrollTop = this.el.scrollHeight;
      this.userScrolled = false; // Reset user scroll flag when we auto-scroll
    }

    this.lastItemCount = currentItemCount;
  }
}
