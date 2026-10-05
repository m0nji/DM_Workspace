import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { builtinAgentProfile, customProfileFrom, isBuiltinProfileId, type AgentProfile } from '../../shared/agent-profiles';
import type { AgentCheck } from '../../shared/types';
import { useAgentProfiles } from '../use-agent-profiles';
import { useAgentChecks } from '../use-agent-checks';
import { AgentLogo } from './AgentLogo';
import { AgentProfileEditor } from './AgentProfileEditor';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Switch } from './Switch';
import { CodexSmartphoneSettings } from './CodexSmartphoneSettings';

interface MenuState { profile: AgentProfile; index: number; x: number; y: number; }

export function AgentSettingsSection(): React.JSX.Element {
  const { t } = useTranslation();
  const profiles = useAgentProfiles();
  const setProfiles = useStore(s => s.setAgentProfiles);
  const focus = useStore(s => s.agentSettingsFocus);
  const [editing, setEditing] = useState<string | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [creating, setCreating] = useState<AgentProfile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AgentProfile | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const checks = useAgentChecks(profiles);
  useEffect(() => {
    if (!focus) return;
    setEditing(focus);
    useStore.getState().setAgentSettingsFocus(null);
  }, [focus]);

  const replace = (next: AgentProfile): void => setProfiles(profiles.map(p => p.id === next.id ? next : p));
  const move = (index: number, delta: -1 | 1): void => {
    const next = [...profiles];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setProfiles(next);
  };
  const insertAfter = (index: number, profile: AgentProfile): void => {
    const next = [...profiles];
    next.splice(index + 1, 0, profile);
    setProfiles(next);
    setEditing(profile.id);
  };
  const toggleEditing = (id: string): void => setEditing(editing === id ? null : id);
  // Shared by the ⋯ menu's "Zurücksetzen" item and the editor's own reset
  // button so the two call sites can never drift apart.
  const resetProfile = (profile: AgentProfile): void => {
    replace({ ...builtinAgentProfile(profile.id as 'claude' | 'codex' | 'opencode'), showInMenu: profile.showInMenu });
    setResetVersion(v => v + 1);
  };

  const menuItems = (profile: AgentProfile, index: number): MenuItem[] => [
    { label: editing === profile.id ? t('common.close') : t('settings.agents.edit'), onClick: () => toggleEditing(profile.id) },
    { label: t('settings.agents.duplicate'), onClick: () => insertAfter(index, customProfileFrom(profile, `${profile.name}${t('settings.agents.copySuffix')}`)) },
    { label: t('settings.agents.moveUp'), disabled: index === 0, onClick: () => move(index, -1) },
    { label: t('settings.agents.moveDown'), disabled: index === profiles.length - 1, onClick: () => move(index, 1) },
    { label: '-' },
    isBuiltinProfileId(profile.id)
      ? { label: t('settings.agents.reset'), onClick: () => resetProfile(profile) }
      : { label: t('settings.agents.deleteMenu'), onClick: () => setConfirmDelete(profile) }
  ];

  return <div className="settings-group agent-settings">
    <div className="agent-settings-header">
      <div>
        <div className="modal-section-label">{t('settings.nav.agents')}</div>
        <p className="modal-hint">{t('settings.agents.scope')}</p>
      </div>
      {!creating && <button type="button" className="btn-secondary" onClick={() => setCreating(customProfileFrom(
        { ...builtinAgentProfile('opencode'), adapter: 'generic', icon: { kind: 'letter', letter: 'A', color: '#c97b4a' }, command: '' },
        t('settings.agents.customDefaultName')))}>{t('settings.agents.addCustom')}</button>}
    </div>
    {creating && <AgentProfileEditor profile={creating} mode="create"
      onCommit={profile => { setProfiles([...profiles, profile]); setCreating(null); }}
      onCancel={() => setCreating(null)} />}
    <ul className="agent-profile-list">
      {profiles.map((profile, index) => <li key={profile.id} className="agent-profile-item">
        <div className="agent-profile-row" role="button" tabIndex={0} aria-expanded={editing === profile.id}
          onClick={() => toggleEditing(profile.id)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleEditing(profile.id); } }}>
          <AgentLogo icon={profile.icon} name={profile.name} decorative />
          <span className="agent-profile-name">{profile.name}</span>
          <CheckBadge check={checks.get(profile)} command={profile.command} />
          <span className="agent-profile-menu-toggle" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <Switch checked={profile.showInMenu} label={t('settings.agents.showInMenuFor', { name: profile.name })}
              onChange={checked => replace({ ...profile, showInMenu: checked })} />
            <span aria-hidden="true" className="agent-profile-menu-text">{t('settings.agents.showInMenu')}</span>
          </span>
          <button type="button" className="pane-btn agent-profile-menu-btn" aria-haspopup="menu"
            aria-label={t('settings.agents.actionsFor', { name: profile.name })}
            onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ profile, index, x: r.left, y: r.bottom + 4 }); }}>⋯</button>
        </div>
        {editing === profile.id && <AgentProfileEditor key={`${profile.id}:${resetVersion}`} profile={profile} mode="edit" onCommit={replace}
          onCheck={() => checks.recheck(profile)}
          onReset={isBuiltinProfileId(profile.id) ? () => resetProfile(profile) : undefined}
          onDelete={isBuiltinProfileId(profile.id) ? undefined : () => setConfirmDelete(profile)} />}
      </li>)}
    </ul>
    {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.profile, menu.index)} onClose={() => setMenu(null)} />,
      document.querySelector('.root') ?? document.body)}
    <CodexSmartphoneSettings />
    {confirmDelete && createPortal(<ConfirmDialog tone="danger" title={t('settings.agents.deleteTitle')}
      message={t('settings.agents.deleteMessage', { name: confirmDelete.name })}
      confirmLabel={t('settings.agents.delete')} cancelLabel={t('common.cancel')}
      onCancel={() => setConfirmDelete(null)}
      onConfirm={() => { setProfiles(profiles.filter(p => p.id !== confirmDelete.id)); setConfirmDelete(null); setEditing(null); }} />,
      document.querySelector('.root') ?? document.body)}
  </div>;
}

function CheckBadge({ check, command }: { check: AgentCheck | 'checking' | undefined; command: string }): React.JSX.Element {
  const { t } = useTranslation();
  if (!check || check === 'checking') return <span className="agent-check">
    <span className="agent-check-dot pending" aria-hidden="true" />{t('settings.agents.checking')}</span>;
  if (check === 'ready') return <span className="agent-check">
    <span className="agent-check-dot ok" aria-hidden="true" />{t('settings.agents.found')}</span>;
  return <span className="agent-check" title={t(`agent.startErrors.${check}`, { command })}>
    <span className={`agent-check-dot ${check === 'missing-cli' ? 'missing' : 'warn'}`} aria-hidden="true" />
    {t(check === 'missing-cli' ? 'settings.agents.notFound' : 'settings.agents.checkProblem')}</span>;
}
