import React from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import type { PresetKind } from '../../shared/types';
// Colored DM wordmark for dark surfaces — copied verbatim from the brand repo
// (DM_CICD 02_logo); never redrawn or recolored per the logo rules.
import logoUrl from '../assets/dm-apps-logo-final-dark-colored.svg';

const PRESETS = [
  { kind: '1',  labelKey: 'welcome.preset.single',     cols: 1, rows: 1, cells: 1 },
  { kind: '2h', labelKey: 'welcome.preset.sideBySide', cols: 2, rows: 1, cells: 2 },
  { kind: '2v', labelKey: 'welcome.preset.stacked',    cols: 1, rows: 2, cells: 2 },
  { kind: '4',  labelKey: 'welcome.preset.quad',       cols: 2, rows: 2, cells: 4 },
  { kind: '8',  labelKey: 'welcome.preset.eight',      cols: 4, rows: 2, cells: 8 }
] as const satisfies ReadonlyArray<{ kind: PresetKind; labelKey: string; cols: number; rows: number; cells: number; }>;

interface Props { workspaceId: string; cwd: string; }

export function WelcomeScreen({ workspaceId, cwd }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const applyPreset = useStore((s) => s.applyPreset);
  const setWorkspaceCwd = useStore((s) => s.setWorkspaceCwd);
  const templates = useStore((s) => s.workspaceTemplates ?? []);
  const launchTemplate = useStore((s) => s.launchTemplateIntoWorkspace);
  const setTasksEnabled = useStore((s) => s.setTasksEnabled);
  const tasksEnabled = useStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.tasksEnabled ?? false);

  const chooseFolder = async () => {
    const dir = await window.api.pickDirectory();
    if (dir) setWorkspaceCwd(workspaceId, dir);
  };

  return (
    <div className="welcome">
      <img className="welcome-logo" src={logoUrl} alt="DM Apps" />
      <h2>{t('welcome.heading')}</h2>
      <div className="welcome-cwd">
        <span className="label">{t('welcome.workingDirectory')}</span>
        <code className="cwd-value" title={cwd}>{cwd}</code>
        <button className="cwd-btn" onClick={() => void chooseFolder()}>{t('welcome.chooseFolder')}</button>
      </div>
      <label className="welcome-tasks-toggle">
        <input type="checkbox" checked={tasksEnabled}
               onChange={(e) => setTasksEnabled(workspaceId, e.target.checked)} />
        {t('welcome.enableTasks')}
      </label>
      <div className="preset-row">
        {PRESETS.map((p) => (
          <button type="button" key={p.kind} className="preset" onClick={() => applyPreset(p.kind)}>
            <div
              className="glyph"
              style={{
                width: p.cols > 2 ? 130 : 90,
                gridTemplateColumns: `repeat(${p.cols}, 1fr)`,
                gridTemplateRows: `repeat(${p.rows}, 1fr)`
              }}
            >
              {Array.from({ length: p.cells }).map((_, i) => <div key={i} className="cell" />)}
            </div>
            <div className="label">{t(p.labelKey)}</div>
          </button>
        ))}
      </div>

      <div className="welcome-templates">
        <span className="label">{t('welcome.orTemplate')}</span>
        {templates.length === 0 ? (
          <p className="welcome-template-hint">
            {t('welcome.noTemplates')}
          </p>
        ) : (
          <div className="welcome-template-cards">
            {templates.map((tpl) => {
              const cmdCount = tpl.startupCommands ? Object.keys(tpl.startupCommands).length : 0;
              return (
                <button
                  type="button"
                  key={tpl.id}
                  className="welcome-template-card"
                  onClick={() => launchTemplate(workspaceId, tpl.id)}
                  title={tpl.cwd}
                >
                  <span className="welcome-template-name">{tpl.name}</span>
                  <span className="welcome-template-meta">
                    {tpl.cwd}{cmdCount ? ` · ${t('welcome.templateStartupCommands', { count: cmdCount })}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
