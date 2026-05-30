import React, { useEffect } from 'react';
import { useStore } from '../store';

// Shown before creating a workspace from a template that carries startup
// commands (when the template asks for confirmation). Lets the user run the
// commands, skip them, or cancel entirely.
export function StartupCommandConfirmDialog(): JSX.Element | null {
  const pending = useStore((s) => s.pendingTemplateLaunch);
  const setPending = useStore((s) => s.setPendingTemplateLaunch);
  const templates = useStore((s) => s.workspaceTemplates ?? []);
  const createFromTemplate = useStore((s) => s.createWorkspaceFromTemplate);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); setPending(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, setPending]);

  if (!pending) return null;
  const tpl = templates.find((t) => t.id === pending.templateId);
  if (!tpl) return null;

  const commands = tpl.startupCommands ?? {};
  const entries = Object.entries(commands);
  const close = (): void => setPending(null);
  const createWith = (): void => { createFromTemplate(tpl.id, true); close(); };
  const createWithout = (): void => { createFromTemplate(tpl.id, false); close(); };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal startup-confirm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Run startup commands?</span>
          <button className="modal-close" title="Close" onClick={close}>✕</button>
        </div>
        <p className="modal-hint" style={{ marginTop: 0 }}>
          <strong>{tpl.name}</strong> will run these commands in its panes. Review them before continuing.
        </p>
        <div className="startup-cmd-list">
          {entries.map(([paneId, cmd]) => (
            <div className="startup-cmd-row" key={paneId}>
              <span className="startup-cmd-pane">{tpl.paneTitles?.[paneId] ?? paneId}</span>
              <code className="startup-cmd-code">{cmd}</code>
            </div>
          ))}
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={close}>Cancel</button>
          <button className="confirm-btn" onClick={createWithout}>Create without commands</button>
          <button className="confirm-btn primary" onClick={createWith} autoFocus>Create and run</button>
        </div>
      </div>
    </div>
  );
}
