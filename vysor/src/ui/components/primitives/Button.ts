// src/ui/components/primitives/Button.ts
import { Component } from '../Base';

export class Button extends Component<{
  label: string;
  title?: string;
  disabled?: boolean;
  kind?: 'normal' | 'primary' | 'ghost';
  onClick?: () => void;
}> {
  constructor() {
    super('button', 'btn');
  }

  protected render(): void {
    const { label, title, disabled, kind = 'normal', onClick } = this.props;

    const btn = this.el as HTMLButtonElement;
    btn.className = `btn ${kind}`;
    btn.type = 'button';
    btn.textContent = label;
    if (title) btn.title = title;
    btn.disabled = !!disabled;

    // Avoid type mismatch: wrap handler
    btn.onclick = onClick ? (() => onClick()) : null;
  }
}
