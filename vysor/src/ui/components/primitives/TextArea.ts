// src/ui/components/primitives/TextArea.ts
import { Component } from '../Base';

export class TextArea extends Component<{
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onInput?: (v: string, e: InputEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}> {
  private ta = document.createElement('textarea');

  constructor() {
    super('div');
    this.ta.className = 'input';
    this.ta.autocomplete = 'off';
    this.ta.autocapitalize = 'off';
    this.ta.spellcheck = false;
    this.el.appendChild(this.ta);
  }

  focusEnd() {
    const v = this.ta.value;
    this.ta.focus();
    this.ta.setSelectionRange(v.length, v.length);
  }

  protected render(): void {
    const { value, placeholder, disabled, onInput, onKeyDown } = this.props;

    this.ta.value = value ?? '';
    this.ta.placeholder = placeholder ?? '';
    if (placeholder) this.ta.setAttribute('aria-label', placeholder);
    (this.ta as HTMLTextAreaElement).disabled = !!disabled;

    // Reassigning is fine since we fully control renders
    this.ta.oninput = (e: Event) => {
      const target = e.target as HTMLTextAreaElement;
      onInput?.(target.value, e as InputEvent);
    };
    this.ta.onkeydown = onKeyDown
      ? (e: KeyboardEvent) => onKeyDown(e)
      : null;
  }
}
