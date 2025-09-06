// src/ui/components/TraceView.ts
import { Component } from './Base';

export class TraceView extends Component<{ lines: string[] }> {
  protected render(): void {
    this.el.className = 'trace';
    this.el.setAttribute('role', 'log');
    this.el.setAttribute('aria-live', 'polite');
    const lines = this.props?.lines ?? [];
    this.el.textContent = lines.length ? lines.join('\n') : '';
  }
}
