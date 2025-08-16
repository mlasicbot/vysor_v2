// src/ui/components/Composer.ts
import { Component } from './Base';
import { IconButton } from './primitives/IconButton';
import { TextArea } from './primitives/TextArea';
import { MentionsPopup } from './MentionsPopup';
import { StatusBar } from './StatusBar';
import type { MentionItem } from '../types';

export class Composer extends Component<{
  draft: string; generating: boolean;
  mentionOpen: boolean; mentionItems: MentionItem[];
  onDraft: (value: string, ev: InputEvent) => void;
  onKeyDown: (ev: KeyboardEvent) => void;
  onOpenMentions: () => void;
  onPickMention: (item: MentionItem) => void;
  onSubmit: () => void;
  onStop: () => void;
}> {
  private ta = new TextArea();
  private mentions = new MentionsPopup();
  private status = new StatusBar();

  protected render(): void {
    this.el.className = 'composer';
    this.el.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'inputRow';
    this.el.appendChild(row);

    new IconButton().mount(row, {
      icon: '@',
      title: 'Add context',
      onClick: this.props.onOpenMentions,
    });

    this.ta.mount(row, {
      value: this.props.draft,
      placeholder: 'Ask anything… (type @ to add files)',
      disabled: this.props.generating,
      onInput: this.props.onDraft,
      onKeyDown: this.props.onKeyDown,
    });

    new IconButton().mount(row, { icon: '📎', title: 'Attach (placeholder)' });

    new IconButton().mount(row, {
      icon: '⏎',
      title: 'Send (Ctrl/Cmd+Enter)',
      onClick: this.props.onSubmit,
      disabled: this.props.generating || !this.props.draft.trim(),
    });

    this.mentions.mount(this.el, {
      open: this.props.mentionOpen,
      items: this.props.mentionItems,
      onPick: this.props.onPickMention,
    });

    this.status.mount(this.el, {
      generating: this.props.generating,
      onStop: this.props.onStop,
    });
  }

  focusInputEnd() {
    this.ta.focusEnd();
  }
}
