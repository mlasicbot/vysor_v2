// src/ui/components/FileBrowser.ts
// File browser for @-mention context system

import { Component } from './Base';
import type { MentionItem } from './Composer';

export interface FileBrowserProps {
  items: MentionItem[];
  currentPath: string;
  query: string;
  onSelect: (item: MentionItem) => void;
  onNavigate: (path: string) => void;
  onSearch: (query: string) => void;
  onClose: () => void;
}

const FILE_ICONS: Record<string, string> = {
  // HDL
  sv: '📦', svh: '📦', v: '📦', vh: '📦', vhd: '📦', vhdl: '📦',
  // Code
  py: '🐍', ts: '💠', tsx: '💠', js: '📜', jsx: '📜',
  // Config
  json: '📋', yaml: '📋', yml: '📋', toml: '⚙️',
  // Docs
  md: '📝', txt: '📄', rst: '📝',
  // Default
  default: '📄',
  dir: '📁',
};

export class FileBrowser extends Component<FileBrowserProps> {
  protected render(): void {
    const { items, currentPath, query, onClose } = this.props;

    this.el.className = 'file-browser';
    this.el.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'fb-header';
    
    const title = document.createElement('div');
    title.className = 'fb-title';
    title.innerHTML = `
      <span class="fb-icon">@</span>
      <span>Add Context</span>
    `;
    header.appendChild(title);
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'fb-close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = onClose;
    header.appendChild(closeBtn);
    
    this.el.appendChild(header);

    // Search
    const searchBox = document.createElement('div');
    searchBox.className = 'fb-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search files...';
    searchInput.value = query;
    searchInput.className = 'fb-search-input';
    searchInput.oninput = (e) => {
      this.props.onSearch((e.target as HTMLInputElement).value);
    };
    searchBox.appendChild(searchInput);
    this.el.appendChild(searchBox);

    // Breadcrumb
    if (currentPath && currentPath !== '.') {
      const breadcrumb = document.createElement('div');
      breadcrumb.className = 'fb-breadcrumb';
      
      const parts = currentPath.split('/').filter(Boolean);
      let pathSoFar = '';
      
      // Root
      const rootBtn = document.createElement('button');
      rootBtn.className = 'fb-crumb';
      rootBtn.textContent = '~';
      rootBtn.onclick = () => this.props.onNavigate('.');
      breadcrumb.appendChild(rootBtn);
      
      for (let i = 0; i < parts.length; i++) {
        const sep = document.createElement('span');
        sep.className = 'fb-sep';
        sep.textContent = '/';
        breadcrumb.appendChild(sep);
        
        pathSoFar += (pathSoFar ? '/' : '') + parts[i];
        const crumb = document.createElement('button');
        crumb.className = 'fb-crumb';
        crumb.textContent = parts[i];
        const p = pathSoFar;
        crumb.onclick = () => this.props.onNavigate(p);
        breadcrumb.appendChild(crumb);
      }
      
      this.el.appendChild(breadcrumb);
    }

    // File list
    const list = document.createElement('div');
    list.className = 'fb-list';

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fb-empty';
      empty.textContent = query ? 'No matches found' : 'No files';
      list.appendChild(empty);
    } else {
      // Sort: directories first, then files
      const sorted = [...items].sort((a, b) => {
        if (a.kind === 'dir' && b.kind !== 'dir') return -1;
        if (a.kind !== 'dir' && b.kind === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });

      for (const item of sorted) {
        const row = document.createElement('div');
        row.className = `fb-item ${item.kind}`;
        
        const icon = this.getIcon(item);
        const iconEl = document.createElement('span');
        iconEl.className = 'fb-item-icon';
        iconEl.textContent = icon;
        row.appendChild(iconEl);
        
        const name = document.createElement('span');
        name.className = 'fb-item-name';
        name.textContent = item.name;
        row.appendChild(name);
        
        if (item.kind === 'dir') {
          const arrow = document.createElement('span');
          arrow.className = 'fb-item-arrow';
          arrow.textContent = '→';
          row.appendChild(arrow);
        }
        
        row.onclick = () => {
          this.props.onSelect(item);
        };
        
        list.appendChild(row);
      }
    }

    this.el.appendChild(list);

    // Quick actions
    const actions = document.createElement('div');
    actions.className = 'fb-actions';
    
    const hint = document.createElement('span');
    hint.className = 'fb-hint';
    hint.textContent = 'ESC to close • Click to select';
    actions.appendChild(hint);
    
    this.el.appendChild(actions);
    
    // Focus search on mount
    setTimeout(() => searchInput.focus(), 50);
  }

  private getIcon(item: MentionItem): string {
    if (item.kind === 'dir') return FILE_ICONS.dir;
    const ext = item.name.split('.').pop()?.toLowerCase() || '';
    return FILE_ICONS[ext] || FILE_ICONS.default;
  }
}

// Inject styles
const STYLE_ID = 'vysor-file-browser-styles';
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .file-browser {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      margin-bottom: 8px;
      background: var(--vysor-bg-raised, #161b22);
      border: 1px solid var(--vysor-border, #30363d);
      border-radius: var(--vysor-radius-lg, 12px);
      box-shadow: var(--vysor-shadow-lg);
      max-height: 400px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: vysor-fade-in 0.15s ease;
      z-index: 1000;
    }
    
    .fb-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--vysor-space-3, 12px);
      border-bottom: 1px solid var(--vysor-border, #30363d);
      background: var(--vysor-bg, #0d1117);
    }
    
    .fb-title {
      display: flex;
      align-items: center;
      gap: var(--vysor-space-2, 8px);
      font-weight: 600;
      color: var(--vysor-fg, #e6edf3);
    }
    
    .fb-icon {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--vysor-accent);
      color: var(--vysor-bg);
      border-radius: var(--vysor-radius-sm, 4px);
      font-weight: 700;
      font-size: 14px;
    }
    
    .fb-close {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid var(--vysor-border, #30363d);
      border-radius: var(--vysor-radius-sm, 4px);
      color: var(--vysor-fg-muted, #7d8590);
      cursor: pointer;
      transition: all var(--vysor-transition-fast);
      font-size: 16px;
    }
    
    .fb-close:hover {
      background: var(--vysor-error-bg);
      border-color: var(--vysor-error);
      color: var(--vysor-error);
    }
    
    .fb-search {
      padding: var(--vysor-space-2, 8px) var(--vysor-space-3, 12px);
      border-bottom: 1px solid var(--vysor-border-muted, #21262d);
    }
    
    .fb-search-input {
      width: 100%;
      padding: var(--vysor-space-2, 8px) var(--vysor-space-3, 12px);
      background: var(--vysor-bg, #0d1117);
      border: 1px solid var(--vysor-border, #30363d);
      border-radius: var(--vysor-radius-md, 8px);
      color: var(--vysor-fg, #e6edf3);
      font-family: inherit;
      font-size: var(--vysor-font-size-sm, 11px);
      outline: none;
      transition: border-color var(--vysor-transition-fast);
    }
    
    .fb-search-input:focus {
      border-color: var(--vysor-accent);
    }
    
    .fb-search-input::placeholder {
      color: var(--vysor-fg-faint, #484f58);
    }
    
    .fb-breadcrumb {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: var(--vysor-space-2, 8px) var(--vysor-space-3, 12px);
      background: var(--vysor-bg, #0d1117);
      font-size: var(--vysor-font-size-xs, 10px);
      overflow-x: auto;
    }
    
    .fb-crumb {
      padding: 2px 6px;
      background: var(--vysor-bg-elevated, #1f2937);
      border: none;
      border-radius: var(--vysor-radius-sm, 4px);
      color: var(--vysor-fg-muted, #7d8590);
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      transition: all var(--vysor-transition-fast);
    }
    
    .fb-crumb:hover {
      background: var(--vysor-accent-muted);
      color: var(--vysor-accent);
    }
    
    .fb-sep {
      color: var(--vysor-fg-faint, #484f58);
    }
    
    .fb-list {
      flex: 1;
      overflow-y: auto;
      padding: var(--vysor-space-2, 8px);
    }
    
    .fb-item {
      display: flex;
      align-items: center;
      gap: var(--vysor-space-2, 8px);
      padding: var(--vysor-space-2, 8px) var(--vysor-space-3, 12px);
      border-radius: var(--vysor-radius-md, 8px);
      cursor: pointer;
      transition: all var(--vysor-transition-fast);
    }
    
    .fb-item:hover {
      background: var(--vysor-bg-elevated, #1f2937);
    }
    
    .fb-item.dir:hover {
      background: var(--vysor-accent-muted);
    }
    
    .fb-item-icon {
      font-size: 16px;
      width: 24px;
      text-align: center;
    }
    
    .fb-item-name {
      flex: 1;
      color: var(--vysor-fg, #e6edf3);
      font-size: var(--vysor-font-size-sm, 11px);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .fb-item.dir .fb-item-name {
      color: var(--vysor-accent);
      font-weight: 500;
    }
    
    .fb-item-arrow {
      color: var(--vysor-fg-faint, #484f58);
      font-size: 12px;
    }
    
    .fb-empty {
      padding: var(--vysor-space-6, 24px);
      text-align: center;
      color: var(--vysor-fg-faint, #484f58);
      font-size: var(--vysor-font-size-sm, 11px);
    }
    
    .fb-actions {
      display: flex;
      justify-content: center;
      padding: var(--vysor-space-2, 8px);
      border-top: 1px solid var(--vysor-border-muted, #21262d);
      background: var(--vysor-bg, #0d1117);
    }
    
    .fb-hint {
      font-size: var(--vysor-font-size-xs, 10px);
      color: var(--vysor-fg-faint, #484f58);
    }
    
    @keyframes vysor-fade-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

