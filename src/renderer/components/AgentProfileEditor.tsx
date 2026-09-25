import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AGENT_ADAPTERS, AGENT_LOGO_IDS, isBuiltinProfileId, previewCommand, supportsRemoteControl,
  type AgentIcon, type AgentProfile } from '../../shared/agent-profiles';
import { fromDraft, toDraft, type AgentProfileDraft, type DraftErrors } from '../agent-profile-draft';
import { AgentLogo } from './AgentLogo';
import { Switch } from './Switch';

interface Props {
  profile: AgentProfile;
  mode: 'edit' | 'create';
  onCommit: (profile: AgentProfile) => void; // edit: every valid change; create: the add button
  onCheck?: () => void;
  onReset?: () => void;
  onDelete?: () => void;
  onCancel?: () => void;
}

export function AgentProfileEditor({ profile, mode, onCommit, onCheck, onReset, onDelete, onCancel }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<AgentProfileDraft>(() => toDraft(profile));
  const [errors, setErrors] = useState<DraftErrors>({});
  const builtin = isBuiltinProfileId(profile.id);
  const id = (field: string): string => `agent-${profile.id}-${field}`;
  const change = (patch: Partial<AgentProfileDraft>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    const result = fromDraft({ id: profile.id, showInMenu: profile.showInMenu }, next);
    setErrors(result.errors);
    if (mode === 'edit' && result.profile) onCommit(result.profile);
  };
  const valid = fromDraft({ id: profile.id, showInMenu: profile.showInMenu }, draft).profile;
  const setIcon = (icon: AgentIcon): void => change({ icon });
  const error = (field: keyof DraftErrors): React.ReactNode => {
    const value = errors[field];
    if (!value) return null;
    // Field and value are correlated at every call site (e.g. error('args')
    // only ever reads an 'unclosed' | 'empty' value), but a non-generic
    // `keyof DraftErrors` parameter makes TS widen `errors[field]` to the
    // union of every field's values, producing invalid cross combinations
    // (e.g. "errors.name.letter") that the typed t() key union rejects. The
    // key is always one of the real per-field combinations at runtime.
    const key = `settings.agents.errors.${field}.${value}`;
    // key is always a real "settings.agents.errors.<field>.<value>" leaf (see
    // above); the typed t() overloads cannot correlate the two separately
    // typed parts, so a plain `keyof DraftErrors` correlation is not provable.
    // aria-live="polite" (in addition to role="alert", which implies
    // assertive) keeps the region from barging in on every keystroke while
    // still exposing it as an alert to AT that key off the role.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    return <p className="setting-error" role="alert" aria-live="polite">{t(key as any)}</p>;
  };
  const iconKind = draft.icon.kind === 'logo' ? draft.icon.logo : 'letter';

  return <div className="agent-profile-editor">
    <div className="agent-editor-grid-2">
      <div className="agent-field">
        <label className="wizard-label" htmlFor={id('name')}>{t('settings.agents.fields.name')}</label>
        <input id={id('name')} className="wizard-input" value={draft.name} maxLength={60} onChange={e => change({ name: e.target.value })} />
        {error('name')}
      </div>
      <div className="agent-field">
        <label className="wizard-label" htmlFor={id('adapter')}>{t('settings.agents.fields.adapter')}</label>
        <div className="wizard-select-wrap">
          <select id={id('adapter')} className="wizard-input" value={draft.adapter} disabled={builtin}
            onChange={e => change({ adapter: e.target.value as AgentProfileDraft['adapter'] })}>
            {AGENT_ADAPTERS.map(a => <option key={a} value={a}>{t(`settings.agents.adapter.${a}`)}</option>)}
          </select>
        </div>
        <p className="modal-hint">{t(`settings.agents.adapterHint.${draft.adapter}`)}</p>
      </div>
    </div>

    <div className="agent-field">
      <label className="wizard-label" htmlFor={id('command')}>{t('settings.agents.fields.command')}</label>
      <input id={id('command')} className="wizard-input mono" value={draft.command} spellCheck={false} onChange={e => change({ command: e.target.value })} />
      <p className="modal-hint">{t('settings.agents.commandHint')}</p>
      {error('command')}
    </div>

    <div className="agent-field">
      <label className="wizard-label" htmlFor={id('args')}>{t('settings.agents.fields.args')}</label>
      <input id={id('args')} className="wizard-input mono" value={draft.argsText} spellCheck={false} onChange={e => change({ argsText: e.target.value })} />
      {error('args')}
    </div>

    <fieldset className="agent-env">
      <legend className="wizard-label">{t('settings.agents.fields.env')}</legend>
      {draft.env.map((row, i) => <div key={i} className="agent-env-row">
        <input className="wizard-input mono" aria-label={t('settings.agents.fields.envName')} value={row.key} spellCheck={false}
          onChange={e => change({ env: draft.env.map((r, j) => j === i ? { ...r, key: e.target.value } : r) })} />
        <span aria-hidden="true">=</span>
        <input className="wizard-input mono" aria-label={t('settings.agents.fields.envValue')} value={row.value} spellCheck={false}
          onChange={e => change({ env: draft.env.map((r, j) => j === i ? { ...r, value: e.target.value } : r) })} />
        <button type="button" className="pane-btn" aria-label={t('settings.agents.envRemove')}
          onClick={() => change({ env: draft.env.filter((_, j) => j !== i) })}>✕</button>
      </div>)}
      <div className="agent-env-actions">
        <button type="button" className="btn-link" onClick={() => setDraft({ ...draft, env: [...draft.env, { key: '', value: '' }] })}>{t('settings.agents.envAdd')}</button>
        <span className="modal-hint">{t('settings.agents.secretsWarning')}</span>
      </div>
    </fieldset>
    {error('env')}

    <div className="agent-field">
      <span className="wizard-label">{t('settings.agents.fields.icon')}</span>
      <div className="icon-chip-group" role="radiogroup" aria-label={t('settings.agents.fields.icon')}>
        {AGENT_LOGO_IDS.map(logo => {
          const name = t(`settings.agents.logo.${logo}`);
          return <button key={logo} type="button" role="radio" aria-checked={iconKind === logo}
            className={`icon-chip${iconKind === logo ? ' selected' : ''}`} aria-label={name}
            onClick={() => setIcon({ kind: 'logo', logo })}>
            <AgentLogo icon={{ kind: 'logo', logo }} name={name} decorative size={16} />
          </button>;
        })}
        <button type="button" role="radio" aria-checked={draft.icon.kind === 'letter'}
          className={`icon-chip icon-chip-letter${draft.icon.kind === 'letter' ? ' selected' : ''}`}
          onClick={() => setIcon({ kind: 'letter', letter: Array.from(draft.name.trim())[0] ?? 'A', color: '#c97b4a' })}>
          {t('settings.agents.logo.letter')}
        </button>
      </div>
      {draft.icon.kind === 'letter' && <div className="setting-row agent-icon-extra">
        <input aria-label={t('settings.agents.fields.letter')} className="wizard-input agent-letter-input" value={draft.icon.letter} maxLength={2}
          onChange={e => setIcon({ ...draft.icon as Extract<AgentIcon, { kind: 'letter' }>, letter: e.target.value })} />
        <input aria-label={t('settings.agents.fields.color')} type="color" value={draft.icon.color}
          onChange={e => setIcon({ ...draft.icon as Extract<AgentIcon, { kind: 'letter' }>, color: e.target.value })} />
      </div>}
      {error('icon')}
    </div>

    {supportsRemoteControl(draft.adapter) && <div className="setting-row">
      {/* The visible <label htmlFor> below already names this control; passing
          an aria-label to Switch too would just shadow it with the same text. */}
      <label htmlFor={id('remote')}>{t('settings.agents.autoRemote')}</label>
      <Switch id={id('remote')} checked={draft.remoteControl} onChange={checked => change({ remoteControl: checked })} />
    </div>}
    {draft.adapter === 'claude' && <>
      <p className="modal-hint">{t('settings.agents.claudeHint')}</p>
      <button type="button" className="btn-secondary" onClick={() => window.api.openExternal('https://claude.ai/code')}>{t('settings.agents.openClaude')}</button>
    </>}
    {draft.adapter === 'opencode' && <>
      <p className="modal-hint">{t('settings.agents.opencodeHint')}</p>
      <button type="button" className="btn-secondary" onClick={() => window.api.openExternal('https://opencode.ai/docs/web/')}>{t('settings.agents.openGuide')}</button>
    </>}
    {valid && <div className="agent-command-preview">
      <span className="modal-section-label">{t('settings.agents.fields.preview')}</span>
      <code>{previewCommand(valid, window.api.platform === 'win32')}</code>
      {(valid.adapter === 'claude' || valid.adapter === 'codex') && <span className="modal-hint"> {t('settings.agents.previewHooks')}</span>}
    </div>}
    {error('form')}
    <div className="agent-editor-actions">
      {mode === 'create'
        ? <>
            <button type="button" className="btn-secondary" disabled={!valid} onClick={() => valid && onCommit(valid)}>{t('settings.agents.add')}</button>
            <button type="button" className="btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
          </>
        : <>
            {onCheck && <button type="button" className="btn-secondary" onClick={onCheck}>{t('settings.agents.checkProfile')}</button>}
            <span className="agent-editor-actions-spacer" />
            {onReset && <button type="button" className="btn-secondary" onClick={onReset}>{t('settings.agents.reset')}</button>}
            {onDelete && <button type="button" className="btn-secondary btn-danger" onClick={onDelete}>{t('settings.agents.delete')}</button>}
          </>}
    </div>
  </div>;
}
