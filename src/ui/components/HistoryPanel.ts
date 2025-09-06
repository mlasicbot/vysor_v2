// src/ui/components/HistoryPanel.ts
import { Component } from './Base';
import type { Session } from '../types';

export class HistoryPanel extends Component<{
  open: boolean;
  items: Session[];
  onPick: (id: string) => void;
}> {
  private resizeListener: (() => void) | null = null;
  protected render(): void {
    this.el.className = 'history-panel';
    this.el.innerHTML = '';

    // Toggle visibility quickly; we still keep the node mounted so layout is stable.
    this.el.style.display = this.props.open ? 'block' : 'none';
    if (!this.props.open) return;

    // Smart positioning: check if there's enough space on the right
    this.updatePosition();
    
    // No need to force wider width now - using horizontal scrolling instead
    
    // Add resize listener for responsive positioning
    this.setupResizeListener();
    
    // Add click outside handler
    this.setupClickOutsideHandler();

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

  private updatePosition(): void {
    // With left positioning, we only need to handle vertical positioning
    // Get the parent history container
    const historyContainer = this.el.parentElement;
    if (!historyContainer) return;

    // Get the viewport dimensions
    const viewportHeight = window.innerHeight;
    
    // Get the history button position
    const historyRect = historyContainer.getBoundingClientRect();
    const panelHeight = Math.min(70 * viewportHeight / 100, 400); // 70vh or max 400px
    
    // Check if there's enough space below
    const spaceBelow = viewportHeight - historyRect.bottom;
    const spaceAbove = historyRect.top;
    
    // Vertical positioning - flip above if not enough space below
    if (spaceBelow >= panelHeight) {
      // Enough space below, position normally
      this.el.style.top = '100%';
      this.el.style.bottom = 'auto';
    } else if (spaceAbove >= panelHeight) {
      // Not enough space below, but enough above
      this.el.style.bottom = '100%';
      this.el.style.top = 'auto';
    } else {
      // Not enough space on either side, use the side with more space
      if (spaceBelow > spaceAbove) {
        this.el.style.top = '100%';
        this.el.style.bottom = 'auto';
      } else {
        this.el.style.bottom = '100%';
        this.el.style.top = 'auto';
      }
    }
  }

  public setZIndex(zIndex: number): void {
    this.el.style.zIndex = zIndex.toString();
  }

  public bringToFront(): void {
    this.el.style.zIndex = '1000';
  }

  public sendToBack(): void {
    this.el.style.zIndex = '500';
  }

  private setupResizeListener(): void {
    // Remove existing listener if any
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
    
    // Create new listener
    this.resizeListener = () => {
      if (this.props.open) {
        this.updatePosition();
      }
    };
    
    // Add listener
    window.addEventListener('resize', this.resizeListener);
  }

  private setupClickOutsideHandler(): void {
    // Add a small delay to avoid immediate closure
    setTimeout(() => {
      document.addEventListener('click', this.handleClickOutside.bind(this), { once: true });
    }, 100);
  }

  private handleClickOutside(event: MouseEvent): void {
    const target = event.target as Node;
    if (!this.el.contains(target)) {
      // Click was outside the history panel, close it
      // We'll need to communicate this back to the parent
      // For now, we'll just hide it
      this.el.style.display = 'none';
    }
  }

  public destroy(): void {
    // Clean up resize listener
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }
    super.destroy();
  }
}
