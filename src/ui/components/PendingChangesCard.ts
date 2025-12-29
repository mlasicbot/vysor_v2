// © ASICBOT Private Limited Inc
// PendingChangesCard - Displays pending file changes from Shadow Workspace

import { Component } from './Base';
import { send } from '../bus';
import type { PendingEditUI, PendingChangesSummaryUI } from '../types';

export interface PendingChangesCardProps {
  edits: PendingEditUI[];
  summary: PendingChangesSummaryUI | null;
  expanded?: boolean;
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
  onAcceptEdit?: (editId: string) => void;
  onRejectEdit?: (editId: string) => void;
  onViewDiff?: (path: string) => void;
}

export class PendingChangesCard extends Component<PendingChangesCardProps> {
  private isExpanded = false;

  protected render(): void {
    const { edits, summary, expanded } = this.props;
    
    if (!edits || edits.length === 0) {
      this.el.innerHTML = '';
      this.el.className = 'pending-changes-card hidden';
      return;
    }

    this.isExpanded = expanded ?? this.isExpanded;
    this.el.className = 'pending-changes-card';
    this.el.innerHTML = '';

    // Header with summary
    const header = document.createElement('div');
    header.className = 'pending-header';
    
    const titleRow = document.createElement('div');
    titleRow.className = 'pending-title-row';
    
    const icon = document.createElement('span');
    icon.className = 'pending-icon';
    icon.textContent = '📁';
    titleRow.appendChild(icon);

    const title = document.createElement('span');
    title.className = 'pending-title';
    title.textContent = `${edits.length} file${edits.length === 1 ? '' : 's'} changed`;
    titleRow.appendChild(title);

    if (summary) {
      const stats = document.createElement('span');
      stats.className = 'pending-stats';
      const parts: string[] = [];
      if (summary.additions > 0) parts.push(`+${summary.additions}`);
      if (summary.deletions > 0) parts.push(`-${summary.deletions}`);
      stats.innerHTML = parts.map((p, i) => 
        `<span class="${i === 0 ? 'stat-add' : 'stat-remove'}">${p}</span>`
      ).join(' ');
      titleRow.appendChild(stats);
    }

    header.appendChild(titleRow);

    // Action buttons row
    const actions = document.createElement('div');
    actions.className = 'pending-actions';

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'btn primary';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.title = 'Clear history (files already saved)';
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.props.onAcceptAll?.();
      send({ type: 'SHADOW/ACCEPT_ALL' });
    });
    actions.appendChild(dismissBtn);

    const reviewBtn = document.createElement('button');
    reviewBtn.className = 'btn secondary';
    reviewBtn.textContent = 'Review';
    reviewBtn.title = 'View changes and diffs';
    reviewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isExpanded = !this.isExpanded;
      this.render();
    });
    actions.appendChild(reviewBtn);

    const undoAllBtn = document.createElement('button');
    undoAllBtn.className = 'btn danger';
    undoAllBtn.textContent = 'Undo All';
    undoAllBtn.title = 'Restore original files';
    undoAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.props.onRejectAll?.();
      send({ type: 'SHADOW/REJECT_ALL' });
    });
    actions.appendChild(undoAllBtn);

    header.appendChild(actions);
    this.el.appendChild(header);

    // Expanded file list
    if (this.isExpanded) {
      const fileList = document.createElement('div');
      fileList.className = 'pending-file-list';

      for (const edit of edits) {
        const fileItem = this.renderFileItem(edit);
        fileList.appendChild(fileItem);
      }

      this.el.appendChild(fileList);
    }
  }

  private renderFileItem(edit: PendingEditUI): HTMLElement {
    const item = document.createElement('div');
    item.className = `pending-file-item ${edit.operationType}`;

    // File icon based on operation type
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    switch (edit.operationType) {
      case 'create':
        icon.textContent = '📄';
        icon.title = 'New file';
        break;
      case 'modify':
        icon.textContent = '✏️';
        icon.title = 'Modified';
        break;
      case 'delete':
        icon.textContent = '🗑️';
        icon.title = 'Deleted';
        break;
      case 'rename':
      case 'move':
        icon.textContent = '🔄';
        icon.title = 'Renamed/Moved';
        break;
      default:
        icon.textContent = '📄';
    }
    item.appendChild(icon);

    // File path
    const pathSpan = document.createElement('span');
    pathSpan.className = 'file-path';
    pathSpan.textContent = edit.path;
    pathSpan.title = edit.path;
    item.appendChild(pathSpan);

    // Line changes
    const changes = document.createElement('span');
    changes.className = 'file-changes';
    if (edit.isNewFile) {
      changes.innerHTML = `<span class="stat-add">+${edit.additions} lines</span>`;
    } else if (edit.isDeleted) {
      changes.innerHTML = `<span class="stat-remove">deleted</span>`;
    } else {
      const parts: string[] = [];
      if (edit.additions > 0) parts.push(`<span class="stat-add">+${edit.additions}</span>`);
      if (edit.deletions > 0) parts.push(`<span class="stat-remove">-${edit.deletions}</span>`);
      changes.innerHTML = parts.join(' ');
    }
    item.appendChild(changes);

    // Individual file actions (shown on hover)
    const itemActions = document.createElement('div');
    itemActions.className = 'file-item-actions';

    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn icon-btn';
    viewBtn.innerHTML = '👁️';
    viewBtn.title = 'View diff';
    viewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.props.onViewDiff?.(edit.path);
      send({ type: 'SHADOW/GET_DIFF', path: edit.path });
    });
    itemActions.appendChild(viewBtn);

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn icon-btn accept';
    acceptBtn.innerHTML = '✓';
    acceptBtn.title = 'Keep this file';
    acceptBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.props.onAcceptEdit?.(edit.id);
      send({ type: 'SHADOW/ACCEPT_EDIT', editId: edit.id });
    });
    itemActions.appendChild(acceptBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn icon-btn reject';
    rejectBtn.innerHTML = '×';
    rejectBtn.title = 'Undo this file';
    rejectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.props.onRejectEdit?.(edit.id);
      send({ type: 'SHADOW/REJECT_EDIT', editId: edit.id });
    });
    itemActions.appendChild(rejectBtn);

    item.appendChild(itemActions);

    return item;
  }
}

