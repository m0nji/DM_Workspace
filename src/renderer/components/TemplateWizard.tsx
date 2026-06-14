import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { collectPaneIds } from '../../shared/layout-tree';
import type { LayoutNode } from '../../shared/types';
import { Icon } from './Icon';

// A compact schematic of a layout tree, echoing the preset glyphs on the welcome
// screen so the user recognizes the captured shape at a glance.
function LayoutMini({ node, highlight }: { node: LayoutNode; highlight?: string }): React.JSX.Element {
  if (node.type === 'pane') {
    return <div className={`mini-pane ${highlight === node.id ? 'hl' : ''}`} />;
  }
  return (
    <div className={`mini-split ${node.direction === 'h' ? 'row' : 'col'}`}>
      <div style={{ flex: node.ratio }}><LayoutMini node={node.children[0]} highlight={highlight} /></div>
      <div style={{ flex: 1 - node.ratio }}><LayoutMini node={node.children[1]} highlight={highlight} /></div>
    </div>
  );
}

const STEPS = ['Name & folder', 'Panes', 'Review'];

function clean(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) if (v.trim()) out[k] = v.trim();
  return out;
}

export function TemplateWizard(): React.JSX.Element | null {
  const wizard = useStore((s) => s.templateWizard);
  const setWizard = useStore((s) => s.setTemplateWizard);
  const templates = useStore((s) => s.workspaceTemplates ?? []);
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const saveAsTemplate = useStore((s) => s.saveActiveWorkspaceAsTemplate);
  const updateTemplate = useStore((s) => s.updateWorkspaceTemplate);

  const editing = wizard.templateId ? templates.find((t) => t.id === wizard.templateId) : null;
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
  // In create mode the blueprint is the active workspace; in edit mode it's the
  // template itself.
  const layout: LayoutNode | null = editing ? editing.layout : (activeWs?.layout ?? null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [confirmStartup, setConfirmStartup] = useState(true);

  // (Re)seed the form whenever the wizard opens or its target changes.
  useEffect(() => {
    if (!wizard.open) return;
    setStep(0);
    if (editing) {
      setName(editing.name);
      setCwd(editing.cwd);
      setTitles({ ...(editing.paneTitles ?? {}) });
      setCommands({ ...(editing.startupCommands ?? {}) });
      setConfirmStartup(editing.confirmStartupCommands);
    } else if (activeWs) {
      setName(`${activeWs.name} template`);
      setCwd(activeWs.cwd);
      setTitles({ ...(activeWs.paneTitles ?? {}) });
      setCommands({});
      setConfirmStartup(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.open, wizard.templateId]);

  const paneIds = useMemo(() => (layout ? collectPaneIds(layout) : []), [layout]);

  // Escape closes the wizard (matches the app's ConfirmDialog convention).
  useEffect(() => {
    if (!wizard.open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); setWizard({ open: false, templateId: null }); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [wizard.open, setWizard]);

  // On step change move focus to the new step's first control so keyboard users
  // keep their place.
  useEffect(() => {
    if (!wizard.open) return;
    bodyRef.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, [step, wizard.open]);

  if (!wizard.open) return null;
  const close = (): void => setWizard({ open: false, templateId: null });

  // A welcome-screen workspace has no layout to capture.
  if (!layout) {
    return (
      <div className="modal-backdrop" onMouseDown={close}>
        <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-header"><span>Save as template</span>
            <button className="modal-close" onClick={close}><Icon name="close" size={16} /></button></div>
          <p className="modal-hint">Open a layout first — there's nothing to capture from the welcome screen.</p>
          <div className="confirm-actions"><button className="confirm-btn primary" onClick={close}>OK</button></div>
        </div>
      </div>
    );
  }

  const nameValid = name.trim().length > 0;
  const hasCommands = Object.values(commands).some((c) => c.trim());

  const save = (): void => {
    if (!nameValid) return;
    if (editing) {
      updateTemplate(editing.id, {
        name: name.trim(),
        cwd: cwd.trim() || editing.cwd,
        paneTitles: clean(titles),
        startupCommands: clean(commands),
        confirmStartupCommands: confirmStartup
      });
    } else {
      saveAsTemplate({
        name: name.trim(),
        cwd: cwd.trim() || undefined,
        paneTitles: clean(titles),
        startupCommands: clean(commands),
        confirmStartupCommands: confirmStartup
      });
    }
    close();
  };

  const chooseDir = async (): Promise<void> => {
    const dir = await window.api.pickDirectory();
    if (dir) setCwd(dir);
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wizard" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{editing ? 'Edit template' : 'Save workspace as template'}</span>
          <button className="modal-close" title="Close" onClick={close}><Icon name="close" size={16} /></button>
        </div>

        <ol className="wizard-rail">
          {STEPS.map((label, i) => (
            <li key={label} className={`wizard-step ${i === step ? 'current' : ''} ${i < step ? 'done' : ''}`}>
              <span className="wizard-step-num">{i + 1}</span>{label}
            </li>
          ))}
        </ol>

        <div className="wizard-body" ref={bodyRef}>
          {step === 0 && (
            <div className="wizard-pane-grid-2">
              <div>
                <label className="wizard-label">Template name</label>
                <input className="wizard-input" value={name} autoFocus
                       onChange={(e) => setName(e.target.value)} placeholder="e.g. Frontend Dev" />
                <label className="wizard-label">Working directory</label>
                <div className="wizard-cwd">
                  <code className="wizard-cwd-value">{cwd || '—'}</code>
                  <button className="cwd-btn" onClick={() => void chooseDir()}>Choose…</button>
                </div>
              </div>
              <div className="wizard-preview">
                <span className="wizard-label">Captured layout</span>
                <div className="mini-frame"><LayoutMini node={layout} /></div>
                <span className="wizard-preview-count">{paneIds.length} pane{paneIds.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-panes">
              {paneIds.map((pid, i) => (
                <div className="wizard-pane-card" key={pid}>
                  <div className="wizard-pane-head">
                    <div className="mini-frame small"><LayoutMini node={layout} highlight={pid} /></div>
                    <span className="wizard-pane-index">Pane {i + 1}</span>
                  </div>
                  <div className="wizard-pane-fields">
                    <input className="wizard-input" placeholder="Pane title (optional)"
                           value={titles[pid] ?? ''} onChange={(e) => setTitles({ ...titles, [pid]: e.target.value })} />
                    <input className="wizard-input mono" placeholder="Startup command (optional)"
                           value={commands[pid] ?? ''} onChange={(e) => setCommands({ ...commands, [pid]: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="wizard-review">
              <div className="wizard-review-row"><span>Name</span><strong>{name || '—'}</strong></div>
              <div className="wizard-review-row"><span>Folder</span><code>{cwd || '—'}</code></div>
              <div className="wizard-review-row top"><span>Panes</span>
                <div className="wizard-review-panes">
                  {paneIds.map((pid, i) => (
                    <div className="wizard-review-pane" key={pid}>
                      <span className="wizard-pane-index">Pane {i + 1}</span>
                      <span>{titles[pid]?.trim() || <em>untitled</em>}</span>
                      {commands[pid]?.trim() && <code className="mono">{commands[pid].trim()}</code>}
                    </div>
                  ))}
                </div>
              </div>
              {hasCommands && (
                <label className="wizard-confirm-toggle">
                  <input type="checkbox" checked={confirmStartup} onChange={(e) => setConfirmStartup(e.target.checked)} />
                  Ask before running startup commands when creating from this template
                </label>
              )}
            </div>
          )}
        </div>

        <div className="wizard-footer">
          <button className="confirm-btn" onClick={step === 0 ? close : () => setStep(step - 1)}>
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {step < STEPS.length - 1 ? (
            <button className="confirm-btn primary" disabled={step === 0 && !nameValid} onClick={() => setStep(step + 1)}>Next</button>
          ) : (
            <button className="confirm-btn primary" disabled={!nameValid} onClick={save}>
              {editing ? 'Save changes' : 'Save template'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
