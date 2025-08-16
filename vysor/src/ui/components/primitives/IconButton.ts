// src/ui/components/primitives/IconButton.ts
import { Component } from '../Base';

export class IconButton extends Component<{
  icon: string;               // can be emoji or short text
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
}> {
  constructor() {
    super('button', 'iconbtn');
  }

  protected render(): void {
    const { icon, title, disabled, onClick } = this.props;

    const btn = this.el as HTMLButtonElement;
    btn.type = 'button';
    btn.className = 'iconbtn';
    btn.textContent = icon;
    if (title) {
      btn.title = title;
      btn.setAttribute('aria-label', title);
    }
    btn.disabled = !!disabled;

    // Avoid type mismatch in strict mode
    btn.onclick = onClick ? (() => onClick()) : null;
  }
}
