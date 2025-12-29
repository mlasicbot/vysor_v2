import { send, onMessage } from './bus';
import { state, current, stringify } from './state';
import type { ExtensionInbound } from './types';
import { Toolbar, MessageList, Composer, HistoryPanel, PendingChangesCard } from './components/index';
import type { MessageBubbleProps } from './components/MessageBubble';

console.log('=== VYSOR UI LOADING ==='); // Basic debug
console.log('Current time:', new Date().toISOString()); // Basic debug

// Try to show an alert to see if JavaScript is working at all
try {
  // alert('Vysor UI is loading...');
  // avoid blocking alert in webview; use console for diagnostics
  console.info('Vysor UI is loading (non-blocking)');
} catch (e) {
  console.log('Alert failed:', e);
}

const root = document.getElementById('root')!;
console.log('Root element found:', root); // Basic debug
console.log('Document ready state:', document.readyState); // Basic debug

let toolbar: Toolbar, composer: Composer, historyPanel: HistoryPanel, messageList: MessageList, pendingChangesCard: PendingChangesCard;

function render() {
  console.log('=== RENDER FUNCTION CALLED ==='); // Basic debug
  root.innerHTML = '';
  const title = current()?.title ?? 'New chat';

  // Top bar
  console.log('Creating toolbar with onClearChat function'); // Debug log
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
      items.push({ role: 'user',      label: 'User', text: t.q });
      items.push({ role: 'assistant', label: 'Vysor', text: t.r, trace: (t.trace || []).map(redactedString) });
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
  messageList = new MessageList().mount(root, { items, generating: state.generating });

  // Pending Changes Card (Shadow Workspace)
  pendingChangesCard = new PendingChangesCard().mount(root, {
    edits: state.pendingEdits,
    summary: state.pendingChangesSummary,
    onAcceptAll: () => send({ type: 'SHADOW/ACCEPT_ALL' }),
    onRejectAll: () => send({ type: 'SHADOW/REJECT_ALL' }),
    onAcceptEdit: (editId) => send({ type: 'SHADOW/ACCEPT_EDIT', editId }),
    onRejectEdit: (editId) => send({ type: 'SHADOW/REJECT_EDIT', editId }),
    onViewDiff: (path) => send({ type: 'SHADOW/GET_DIFF', path }),
  });

  // Composer
  composer = new Composer().mount(root, {
    draft: state.draft,
    generating: state.generating,
    mentionOpen: state.mentionOpen,
    mentionItems: state.mentionItems,
    onDraft: (v, ev) => { 
      state.draft = v; 
      handleMention(ev); 
      // Update just the composer to reflect the new draft state
      updateComposerOnly();
      // Only render if mentions need to be opened/closed, not on every keystroke
      if (state.mentionOpen !== (ev.target as HTMLTextAreaElement)?.value.includes('@')) {
        render();
      }
    },
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
    onPick: (id) => { 
      state.currentId = id; 
      state.historyOpen = false; 
      // Notify extension about chat switch for pending changes scoping
      send({ type: 'CHAT/SWITCH_SESSION', sessionId: id });
      render(); 
    },
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
  // Use updateMessageList instead of render() to prevent multiple bubbles
  updateMessageList();

  if (state.ingestion && state.ingestion.status !== 'hidden') {
    state.ingestion.queriesSince = (state.ingestion.queriesSince ?? 0) + 1;
    if (state.ingestion.queriesSince >= 2) {
      state.ingestion = { status: 'hidden', queriesSince: 0 };
    }
  }

  send({ type:'CHAT/SEND_PROMPT', prompt, contextBlobs: blobs, sessionId: s.id, titleHint });
}

// inbound messages from extension
onMessage((msg: ExtensionInbound) => {
  switch (msg.type) {

    case 'UPLOAD/START':
      console.log('[UI] UPLOAD/START', msg.fileName, 'session:', msg.sessionId);
      state.ingestion = { status: 'ingesting', fileName: msg.fileName, queriesSince: 0, lastAt: Date.now() };
      // Render quickly so user sees banner
      updateComposerOnly();
      break;

    case 'UPLOAD/SUCCESS':
      console.log('[UI] UPLOAD/SUCCESS', msg.fileName, 'session:', msg.sessionId);
      state.ingestion = { status: 'done', fileName: msg.fileName, queriesSince: 0, lastAt: Date.now() };
      updateComposerOnly();
      break;

    case 'UPLOAD/ERROR':
      console.error('[UI] UPLOAD/ERROR', msg.fileName, 'session:', msg.sessionId, 'message:', msg.message);
      state.ingestion = { status: 'error', fileName: msg.fileName, queriesSince: 0, lastAt: Date.now() };
      updateComposerOnly();
      break;

    case 'HISTORY/LOAD_OK':
      state.sessions = msg.history || [];
      const newCurrentId = msg.focus || state.sessions[0]?.id || state.currentId;
      if (newCurrentId !== state.currentId) {
        state.currentId = newCurrentId;
        // Notify extension about chat switch for pending changes scoping
        send({ type: 'CHAT/SWITCH_SESSION', sessionId: newCurrentId });
      } else {
        state.currentId = newCurrentId;
      }
      state.draft = '';
      render();
      break;

    case 'CHAT/STREAM_START':
      state.runId = msg.runId;
      state.generating = true;
      state.liveText = '';
      state.liveTrace = [];
      // Don't call render() here - let updateMessageList handle it
      updateMessageList();
      updateComposerOnly();
      break;

    case 'CHAT/STREAM_DELTA':
      if (state.liveText === 'Generating…') state.liveText = '';
      state.liveText += msg.text;
      // Only update the message list, not the entire UI
      updateMessageList();
      updateComposerOnly();
      break;

    // case 'TRACE/ENTRY':
    //   state.liveTrace.push(stringify(msg.entry));
    //   // Only update the message list, not the entire UI
    //   updateMessageList();
    //   break;

    case 'TRACE/ENTRY': {
  const s = typeof msg.entry === 'string' ? msg.entry : stringify(msg.entry);
  state.liveTrace.push(redactTypedBlocks(s));
  updateMessageList();
  break;
}


    case 'TOOL/EVENT':
      state.liveTrace.push(stringify({ TOOL: msg.evt }));
      // Only update the message list, not the entire UI
      updateMessageList();
      break;

    case 'CHAT/STREAM_END':
      state.generating = false;
      state.runId = '';
      state.draft = '';
      state.liveText = '';
      state.liveTrace = [];
      // Ask for latest history so the newly persisted turn is shown
      updateComposerOnly();
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

    // case 'MENTION/FILE_CONTENT':
    //   state.contextBlobs.push(`FILE: ${msg.path}\n\n${msg.content}`);
    //   closeMentions();
    //   break;
    case 'MENTION/FILE_CONTENT': {
  const path = msg.path || 'unknown';
  const content = msg.content || '';

  if (/<<<\s*(DOC|CODE)\b/.test(content)) {
    // Already typed; pass through as-is
    state.contextBlobs.push(content);
  } else if (path.startsWith('ATTACH:')) {
    const name = path.slice(7);
    const mime = msg.mime || 'application/octet-stream';
    state.contextBlobs.push(
      `<<<DOC name="${name.replace(/"/g,'\\"')}" mime="${mime}">>>\n${content}\n<<<END DOC>>>`
    );
  } else {
    const lang = guessLang(path);
    state.contextBlobs.push(
      `<<<CODE path="${path}" lang="${lang}">>\n${content}\n<<<END CODE>>>`
    );
  }
  closeMentions();
  break;
}

    // ═══════════════════════════════════════════════════════════════════════════
    // SHADOW WORKSPACE MESSAGES
    // ═══════════════════════════════════════════════════════════════════════════
    
    case 'SHADOW/PENDING_CHANGES':
      state.pendingEdits = msg.edits || [];
      state.pendingChangesSummary = msg.summary || null;
      updatePendingChangesCard();
      break;

    case 'SHADOW/ACCEPT_RESULT':
      console.log('[UI] Shadow accept result:', msg);
      if (msg.success) {
        // Show success feedback
        showToast(`✅ ${msg.summary || 'Changes applied'}`);
      } else {
        showToast(`❌ Failed to apply changes`);
      }
      break;

    case 'SHADOW/ACCEPT_ALL_RESULT':
      console.log('[UI] Shadow accept all result:', msg);
      if (msg.success) {
        showToast(`✅ All changes applied (${msg.committedPaths?.length || 0} files)`);
      } else {
        showToast(`❌ Some changes failed to apply`);
      }
      break;

    case 'SHADOW/REJECT_RESULT':
      console.log('[UI] Shadow reject result:', msg);
      if (msg.success) {
        showToast(`↩️ Change reverted`);
      }
      break;

    case 'SHADOW/REJECT_ALL_RESULT':
      console.log('[UI] Shadow reject all result:', msg);
      showToast(`↩️ All changes reverted`);
      break;

    case 'SHADOW/DIFF':
      console.log('[UI] Shadow diff:', msg);
      if (msg.diff) {
        state.diffViewerOpen = true;
        state.diffViewerPath = msg.path;
        state.diffViewerContent = msg.diff;
        showDiffViewer();
      }
      break;

  }
});

function redactTypedBlocks(input: string): string {
  if (typeof input !== 'string') return input as unknown as string;
  // Collapse DOC blocks
  let s = input.replace(
    /<<<DOC\b([^>]*)>>>[\s\S]*?<<<END DOC>>>/g,
    (_m, attrs) => `<<<DOC${attrs}>>>\n[omitted]\n<<<END DOC>>>`
  );
  // Collapse CODE blocks
  s = s.replace(
    /<<<CODE\b([^>]*)>>>[\s\S]*?<<<END CODE>>>/g,
    (_m, attrs) => `<<<CODE${attrs}>>>\n[omitted]\n<<<END CODE>>>`
  );
  return s;
}

function redactedString(x: unknown): string {
  const s = typeof x === 'string' ? x : stringify(x);
  return redactTypedBlocks(s);
}


/** Update only the message list without full re-render */
function updateMessageList() {
  if (messageList) {
    const items: MessageBubbleProps[] = [];
    const sess = current();
    if (sess) {
      sess.turns.forEach((t, i) => {
        items.push({ role: 'user',      label: 'User', text: t.q });
        items.push({ role: 'assistant', label: 'Vysor', text: t.r, trace: (t.trace || []).map(redactedString) });
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
    
    // Update the existing message list instance
    messageList.update({ items, generating: state.generating });
  }
}

/** Update only the composer props without re-rendering */
function updateComposerOnly() {
  if (composer) {
    // Update the composer with new props using the update method
    composer.update({
      draft: state.draft,
      generating: state.generating,
      mentionOpen: state.mentionOpen,
      mentionItems: state.mentionItems,
      onDraft: (v, ev) => { 
        state.draft = v; 
        handleMention(ev); 
        // Update just the composer to reflect the new draft state
        updateComposerOnly();
        // Only render if mentions need to be opened/closed, not on every keystroke
        if (state.mentionOpen !== (ev.target as HTMLTextAreaElement)?.value.includes('@')) {
          render();
        }
      },
      onKeyDown: (ev) => {
        if (ev.key === 'Escape' && state.generating) {
            ev.preventDefault();
            if (state.runId) send({ type:'CHAT/STOP', runId: state.runId });
            return;
          }
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
  }
}

function guessLang(p: string): string {
  const n = p.toLowerCase();
  if (/\.(svh|sv)$/.test(n)) return 'sv';
  if (/\.vhdl?$/.test(n)) return 'vhdl';
  if (/\.v$/.test(n)) return 'verilog';
  if (/\.c$/.test(n)) return 'c';
  if (/\.cpp$/.test(n)) return 'cpp';
  if (/\.py$/.test(n)) return 'python';
  if (/\.md$/.test(n)) return 'markdown';
  if (/\.json$/.test(n)) return 'json';
  if (/\.yaml$|\.yml$/.test(n)) return 'yaml';
  if (/\.tcl$/.test(n)) return 'tcl';
  return 'text';
}


// ═══════════════════════════════════════════════════════════════════════════
// SHADOW WORKSPACE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Update only the pending changes card without full re-render */
function updatePendingChangesCard() {
  if (pendingChangesCard) {
    pendingChangesCard.update({
      edits: state.pendingEdits,
      summary: state.pendingChangesSummary,
      onAcceptAll: () => send({ type: 'SHADOW/ACCEPT_ALL' }),
      onRejectAll: () => send({ type: 'SHADOW/REJECT_ALL' }),
      onAcceptEdit: (editId) => send({ type: 'SHADOW/ACCEPT_EDIT', editId }),
      onRejectEdit: (editId) => send({ type: 'SHADOW/REJECT_EDIT', editId }),
      onViewDiff: (path) => send({ type: 'SHADOW/GET_DIFF', path }),
    });
  }
}

/** Show a simple toast notification */
function showToast(message: string, duration = 3000) {
  // Remove existing toast if any
  const existing = document.querySelector('.vysor-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'vysor-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--panel, #252526);
    color: var(--fg, #ddd);
    padding: 10px 20px;
    border-radius: 8px;
    border: 1px solid var(--border, #3b3b3b);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 1000;
    animation: fadeInUp 0.2s ease;
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

/** Show the diff viewer modal */
function showDiffViewer() {
  // Remove existing viewer if any
  const existing = document.querySelector('.diff-viewer');
  if (existing) existing.remove();

  if (!state.diffViewerContent) return;

  const overlay = document.createElement('div');
  overlay.className = 'diff-viewer';
  overlay.onclick = (e) => {
    if (e.target === overlay) closeDiffViewer();
  };

  const content = document.createElement('div');
  content.className = 'diff-content';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);';
  
  const title = document.createElement('span');
  title.style.cssText = 'font-weight: 600;';
  title.textContent = state.diffViewerPath || 'Diff View';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn secondary';
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'padding: 4px 8px; font-size: 16px;';
  closeBtn.onclick = closeDiffViewer;
  header.appendChild(closeBtn);

  content.appendChild(header);

  // Diff content with syntax highlighting
  const pre = document.createElement('pre');
  const lines = state.diffViewerContent.split('\n');
  
  for (const line of lines) {
    const lineEl = document.createElement('div');
    if (line.startsWith('+') && !line.startsWith('+++')) {
      lineEl.className = 'diff-line-add';
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      lineEl.className = 'diff-line-remove';
    } else if (line.startsWith('@@')) {
      lineEl.className = 'diff-line-header';
    }
    lineEl.textContent = line;
    pre.appendChild(lineEl);
  }
  
  content.appendChild(pre);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  // Close on Escape
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeDiffViewer();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

function closeDiffViewer() {
  state.diffViewerOpen = false;
  state.diffViewerPath = null;
  state.diffViewerContent = null;
  const viewer = document.querySelector('.diff-viewer');
  if (viewer) viewer.remove();
}

/** Request pending changes from extension on boot */
function requestPendingChanges() {
  send({ type: 'SHADOW/GET_PENDING' });
}

// boot
send({ type:'UI/READY' });
if (!state.sessions.length) {
  state.sessions = [{ id:'local', title:'New chat', turns:[], createdAt: Date.now() }];
  state.currentId = 'local';
}
// Notify extension about initial chat for pending changes scoping
if (state.currentId) {
  send({ type: 'CHAT/SWITCH_SESSION', sessionId: state.currentId });
}
render();

// Request pending changes after initial render
setTimeout(requestPendingChanges, 100);
