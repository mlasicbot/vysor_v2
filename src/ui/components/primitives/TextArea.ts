import { Component } from '../Base';

export class TextArea extends Component<{
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onInput: (value: string, ev: InputEvent) => void;
  onKeyDown: (ev: KeyboardEvent) => void;
}> {
  private ta!: HTMLTextAreaElement;

  protected render(): void {
    if (!this.ta) {
      this.ta = document.createElement('textarea');
      this.ta.className = 'input';
      this.el.innerHTML = '';
      this.el.appendChild(this.ta);

      this.ta.addEventListener('input', (ev) =>
        this.props.onInput(this.ta.value, ev as InputEvent)
      );
      this.ta.addEventListener('keydown', (ev) =>
        this.props.onKeyDown(ev)
      );
    }
    this.ta.value = this.props.value ?? '';
    this.ta.placeholder = this.props.placeholder ?? '';
    this.ta.disabled = !!this.props.disabled;
  }

  isFocused(): boolean {
    return document.activeElement === this.ta;
  }
  focusEnd(): void {
    this.ta.focus();
    const len = this.ta.value.length;
    this.ta.setSelectionRange(len, len);
  }
}
