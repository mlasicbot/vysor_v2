import { send, onMessage } from './bus';
import { state, current, stringify } from './state';
import type { ExtensionInbound } from './types';
import { Toolbar, MessageList, Composer, HistoryPanel } from './components/index';
import type { MessageBubbleProps } from './components/MessageBubble';

const root = document.getElementById('root')!;
let toolbar: Toolbar, composer: Composer, historyPanel: HistoryPanel;

function render() {
  root.innerHTML = '';
  const title = current()?.title ?? 'New chat';

  // Top bar
  toolbar = new Toolbar().mount(root, {
    title,
    onNewChat: () => send({ type: 'HISTORY/NEW_SESSION' }),
    onToggleHistory: () => { state.historyOpen = !state.historyOpen; render(); },
  });

  // Messages
  const items: MessageBubbleProps[] = [];
  const sess = current();
  if (sess) {
    sess.turns.forEach((t, i) => {
      items.push({ role: 'user',      label: `Q${i + 1}`, text: t.q });
      items.push({ role: 'assistant', label: `R${i + 1}`, text: t.r, trace: (t.trace || []).map(stringify) });
    });
  }
  if (state.generating) {
    items.push({
      role: 'assistant',
      label: 'Generating…',
      text: state.liveText || 'Generating…',
      trace: state.liveTrace
    });
  }
  new MessageList().mount(root, { items });

  // Composer
  composer = new Composer().mount(root, {
    draft: state.draft,
    generating: state.generating,
    mentionOpen: state.mentionOpen,
    mentionItems: state.mentionItems,
    onDraft: (v, ev) => { state.draft = v; handleMention(ev); },
    onKeyDown: (ev) => {
      if ((ev.key === 'Enter') && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submit(); }
      if (state.mentionOpen && (ev.key === ' ' || ev.key === 'Escape')) { ev.preventDefault(); closeMentions(); }
    },
    onOpenMentions: () => {
      if (!state.mentionOpen) {
        state.mentionOpen = true;
        send({ type: 'MENTION/QUERY', q: '' });
        render();
      }
    },
    onPickMention: (item) => {
      if (item.kind === 'dir') send({ type:'MENTION/LIST_DIR', path:item.path });
      else send({ type:'MENTION/READ_FILE', path:item.path });
    },
    onSubmit: submit,
    onStop: () => { if (state.runId) send({ type:'CHAT/STOP', runId: state.runId }); },
  });

  // History dropdown
  historyPanel = new HistoryPanel().mount(toolbar.historyHost, {
    open: state.historyOpen,
    items: state.sessions,
    onPick: (id) => { state.currentId = id; state.historyOpen = false; render(); },
  });
}

/** Open/close @mentions intelligently without re-rendering on every keystroke */
function handleMention(ev: InputEvent) {
  const target = ev.target as HTMLTextAreaElement | null;
  const val = state.draft;
  const caret = target?.selectionStart ?? val.length;
  const upto = val.slice(0, caret);
  const m = /(^|\s)@([\w\-\.]*)$/.exec(upto);

  if (m) {
    const q = m[2] || '';
    const wasOpen = state.mentionOpen;
    state.mentionOpen = true;
    send({ type:'MENTION/QUERY', q });
    if (!wasOpen) render(); // only render when transitioning closed -> open
  } else if (state.mentionOpen) {
    closeMentions();
  }
}

function closeMentions() {
  state.mentionOpen = false;
  state.mentionItems = [];
  render();
}

function submit() {
  if (state.generating) return;
  const s = current(); if (!s) return;
  const prompt = state.draft.trim(); if (!prompt) return;
  const titleHint = s.turns.length === 0 ? prompt.split(/\s+/).slice(0,3).join(' ') : s.title;

  // One-shot context: send current blobs then clear so they don't persist to later prompts
  const blobs = state.contextBlobs.slice();
  state.contextBlobs = [];

  state.liveText = '';
  state.liveTrace = [];
  state.generating = true;
  render();

  send({ type:'CHAT/SEND_PROMPT', prompt, contextBlobs: blobs, sessionId: s.id, titleHint });
}

// inbound messages from extension
onMessage((msg: ExtensionInbound) => {
  switch (msg.type) {
    case 'HISTORY/LOAD_OK':
      state.sessions = msg.history || [];
      state.currentId = msg.focus || state.sessions[0]?.id || state.currentId;
      state.draft = '';
      render();
      break;

    case 'CHAT/STREAM_START':
      state.runId = msg.runId;
      state.generating = true;
      state.liveText = 'Generating…';
      state.liveTrace = [];
      render();
      break;

    case 'CHAT/STREAM_DELTA':
      if (state.liveText === 'Generating…') state.liveText = '';
      state.liveText += msg.text;
      render();
      break;

    case 'TRACE/ENTRY':
      state.liveTrace.push(stringify(msg.entry));
      render();
      break;

    case 'TOOL/EVENT':
      state.liveTrace.push(stringify({ TOOL: msg.evt }));
      render();
      break;

    case 'CHAT/STREAM_END':
      state.generating = false;
      state.runId = '';
      state.draft = '';
      state.liveText = '';
      state.liveTrace = [];
      // Ask for latest history so the newly persisted turn is shown
      send({ type: 'UI/READY' });
      break;

    case 'CHAT/ERROR':
      state.generating = false;
      state.runId = '';
      alert(msg.message || 'Error');
      render();
      break;

    case 'MENTION/RESULTS':
    case 'MENTION/DIR_CONTENTS':
      state.mentionItems = msg.items;
      render();
      break;

    case 'MENTION/FILE_CONTENT':
      state.contextBlobs.push(`FILE: ${msg.path}\n\n${msg.content}`);
      closeMentions();
      break;
  }
});

// boot
send({ type:'UI/READY' });
if (!state.sessions.length) {
  state.sessions = [{ id:'local', title:'New chat', turns:[], createdAt: Date.now() }];
  state.currentId = 'local';
}
render();
