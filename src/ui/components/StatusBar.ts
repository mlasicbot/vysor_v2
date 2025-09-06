// src/ui/components/StatusBar.ts
import { Component } from './Base';
import { Button } from './primitives/Button';

export class StatusBar extends Component<{
  generating: boolean;
  onStop: () => void;
  ingestion?: { status: 'hidden' | 'ingesting' | 'done' | 'error'; fileName?: string };
}> {
  protected render(): void {
    this.el.className = 'status';
    this.el.innerHTML = '';

    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', this.props.generating ? 'polite' : 'off');

    const ing = this.props.ingestion;
    if (ing && ing.status !== 'hidden') {
      const div = document.createElement('div');
      div.className = 'generating-indicator';
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      const text = document.createElement('div');
      text.className = 'step-text';

      if (ing.status === 'ingesting') {
        text.textContent = `Ingesting ${ing.fileName ?? 'file'}…`;
        div.appendChild(spinner);
      } else if (ing.status === 'done') {
        text.textContent = `File ingested: ${ing.fileName ?? ''}`.trim();
      } else if (ing.status === 'error') {
        text.textContent = `File couldn't be ingested: ${ing.fileName ?? ''}`.trim();
      }
      div.appendChild(text);
      this.el.appendChild(div);
    }

    if (this.props.generating) {
      const t = document.createElement('div');
      t.textContent = 'Generating…';
      this.el.appendChild(t);

      new Button().mount(this.el, {
        label: 'Stop',
        onClick: this.props.onStop,
      });
    }
  }
}
