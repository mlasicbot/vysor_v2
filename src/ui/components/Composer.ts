// src/ui/components/Composer.ts
import { state } from '../state'
import { current } from '../state'
import { send } from '../bus';
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
  private wasFocused = false;
  private fileInput?: HTMLInputElement;

  protected render(): void {
    // Store focus state before re-rendering
    this.wasFocused = this.ta.isFocused();
    
    this.el.className = 'composer';
    this.el.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'inputRow';
    this.el.appendChild(row);
    
    const attachBtn = new IconButton().mount(row, {
      icon: '📎',
      title: 'Attach PDF/PNG/JPG',
      onClick: () => this.fileInput?.click(),
    });

    // Create hidden file input once
    if (!this.fileInput) {
      this.fileInput = document.createElement('input');
      this.fileInput.type = 'file';
      this.fileInput.accept = '.pdf,image/png,image/jpeg';
      this.fileInput.multiple = true;
      this.fileInput.style.display = 'none';

      this.fileInput.addEventListener('change', async () => {
        const files = Array.from(this.fileInput!.files ?? []);
        const sessionId = (current()?.id) || 'local';

        for (const f of files) {
          try{
          const ab = await f.arrayBuffer();
          const b64 = arrayBufferToBase64(ab);
          const mime = f.type || guessMimeByExt(f.name);

          // Tell the extension to OCR this file (async)
          send({
            type: 'UPLOAD/FILE',
            name: f.name,
            mime,
            dataBase64: b64,
            sessionId
          });}
        catch (e) {console.error('[Composer] failed to read/send file', f.name, e); }
 
        }

        // allow re-selecting the same file later
        this.fileInput!.value = '';
      });

      // mount hidden input
      this.el.appendChild(this.fileInput);
    }
    // // hidden input for files
    // if (!this.fileInput) {
    //   this.fileInput = document.createElement('input');
    //   this.fileInput.type = 'file';
    //   this.fileInput.accept = '.pdf,image/png,image/jpeg';
    //   this.fileInput.multiple = true;
    //   this.fileInput.style.display = 'none';
    //   this.fileInput.addEventListener('change', async () => {
    //     const files = Array.from(this.fileInput.files ?? []);
    //     for (const f of files) {
    //       const ab = await f.arrayBuffer();
    //       const b64 = arrayBufferToBase64(ab);
    //       // Send to extension; it will call OCR and push back as MENTION/FILE_CONTENT
    //       window.postMessage; // keep TS happy in some setups
    //       (window as any);     // (no-op)
    //       // Use bus.ts helper
    //       // send is already imported in app.ts; import it here too:
    //     }
    //     // Use bus API:
    //     // NOTE: we’re inside Composer; simplest: import { send } from '../bus' at top
    //     files.forEach(async (f) => {
    //       const ab = await f.arrayBuffer();
    //       const b64 = arrayBufferToBase64(ab);
    //       // @ts-ignore send is available via import at top
    //       // send({ type: 'UPLOAD/FILE', name: f.name, mime: f.type || guessMimeByExt(f.name), dataBase64: b64 });
    //       send({ type: 'UPLOAD/FILE', name: f.name, mime: mime, dataBase64: b64, sessionId: current()?.id || 'local' });
    //     });

    //     // clear selection so the same file can be chosen again later
    //     this.fileInput.value = '';
    //   });
    //   // mount hidden input into component root
    //   this.el.appendChild(this.fileInput);
    // }

    this.ta.mount(row, {
      value: this.props.draft,
      placeholder: 'Ask anything… (type @ to add files)',
      disabled: this.props.generating,
      onInput: this.props.onDraft,
      onKeyDown: this.props.onKeyDown,
    });

    // new IconButton().mount(row, { icon: '📎', title: 'Attach (placeholder)' });

    new IconButton().mount(row, {
      icon: '⏎',
      title: 'Send (Ctrl/Cmd+Enter)',
      onClick: this.props.onSubmit,
      disabled: this.props.generating || !this.props.draft.trim(),
    });

    if (this.props.generating) {
      new IconButton().mount(row, {
        icon: '⏹',
        title: 'Stop (Esc)',
        onClick: this.props.onStop,
        disabled: false,
      });
    }

    this.status.mount(this.el, {
      generating: this.props.generating,
      onStop: this.props.onStop,
      ingestion: (state as any).ingestion
    });


    this.mentions.mount(this.el, {
      open: this.props.mentionOpen,
      items: this.props.mentionItems,
      onPick: this.props.onPickMention,
    });

    // this.status.mount(this.el, {
    //   generating: this.props.generating,
    //   onStop: this.props.onStop,
    // });

    // Restore focus if it was previously focused
    if (this.wasFocused) {
      setTimeout(() => this.ta.focusEnd(), 0);
    }
  }

  focusInputEnd() {
    this.ta.focusEnd();
  }
}

// helpers (place below the class in the same file)
function arrayBufferToBase64(ab: ArrayBuffer): string {
  // const uint8 = new Uint8Array(ab);
  // let s = '';
  // for (let i = 0; i < uint8.length; i++) s += String.fromCharCode(uint8[i]);
  // return btoa(s);
const chunkSize = 0x8000; // 32KB per chunk
const uint8 = new Uint8Array(ab);
let result = '';
for (let i = 0; i < uint8.length; i += chunkSize) {
  const slice = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
  // Array.from here keeps apply/call stack small
  result += String.fromCharCode.apply(null, Array.from(slice) as any);
}
return btoa(result);
}
function guessMimeByExt(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}
