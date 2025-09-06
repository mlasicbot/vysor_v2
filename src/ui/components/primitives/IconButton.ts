import { Component } from '../Base';

export class IconButton extends Component<{
  icon: string;
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
    btn.textContent = icon;
    if (title) btn.title = title;
    btn.disabled = !!disabled;
    btn.onclick = null;
    if (onClick) btn.onclick = onClick;
  }
}
