// src/ui/components/StatusBar.ts
import { Component } from './Base';
import { Button } from './primitives/Button';

export class StatusBar extends Component<{ generating: boolean; onStop: () => void }> {
  protected render(): void {
    this.el.className = 'status';
    this.el.innerHTML = '';

    // a11y: only speak changes when generating
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', this.props.generating ? 'polite' : 'off');

    if (this.props.generating) {
      const t = document.createElement('div');
      t.textContent = 'Generating…';
      this.el.appendChild(t);

      new Button().mount(this.el, {
        label: 'Stop',
        onClick: this.props.onStop,
        // Button component should already set type="button"; if not, add it there.
      });
    }
  }
}
