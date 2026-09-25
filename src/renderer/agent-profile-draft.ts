import { ENV_NAME, joinArgs, parseAgentProfile, splitArgs, supportsRemoteControl,
  type AgentAdapter, type AgentIcon, type AgentProfile } from '../shared/agent-profiles';

export interface AgentProfileDraft {
  name: string; adapter: AgentAdapter; command: string; argsText: string;
  env: Array<{ key: string; value: string }>; icon: AgentIcon; remoteControl: boolean;
}
// Value types are narrowed to each field's actual literals (not `string`) so
// AgentProfileEditor's `t(\`settings.agents.errors.${field}.${errors[field]}\`)`
// resolves to a literal i18n key instead of a `${string}` pattern that the
// typed t() signature (see i18n/i18next.d.ts) cannot accept.
export interface DraftErrors {
  name?: 'required';
  command?: 'required';
  args?: 'unclosed' | 'empty';
  env?: 'name' | 'duplicate';
  icon?: 'letter';
  form?: 'invalid';
}

export function toDraft(profile: AgentProfile): AgentProfileDraft {
  return { name: profile.name, adapter: profile.adapter, command: profile.command, argsText: joinArgs(profile.args),
    env: Object.entries(profile.env).map(([key, value]) => ({ key, value })), icon: profile.icon, remoteControl: profile.remoteControl === true };
}

export function fromDraft(base: Pick<AgentProfile, 'id' | 'showInMenu'>, draft: AgentProfileDraft): { profile: AgentProfile | null; errors: DraftErrors } {
  const errors: DraftErrors = {};
  if (!draft.name.trim()) errors.name = 'required';
  if (!draft.command.trim()) errors.command = 'required';
  const args = splitArgs(draft.argsText);
  if (args === null) errors.args = 'unclosed';
  else if (args.some(arg => arg === '')) errors.args = 'empty';
  const env: Record<string, string> = {};
  for (const { key, value } of draft.env) {
    if (!key && !value) continue;
    if (!ENV_NAME.test(key) || /^DMWS_/i.test(key)) { errors.env = 'name'; continue; }
    if (key in env) { errors.env = 'duplicate'; continue; }
    env[key] = value;
  }
  if (draft.icon.kind === 'letter' && Array.from(draft.icon.letter.trim()).length !== 1) errors.icon = 'letter';
  if (Object.keys(errors).length > 0) return { profile: null, errors };
  const profile = parseAgentProfile({
    id: base.id, adapter: draft.adapter, name: draft.name, icon: draft.icon, command: draft.command,
    args, env, showInMenu: base.showInMenu,
    ...(supportsRemoteControl(draft.adapter) ? { remoteControl: draft.remoteControl } : {})
  });
  return profile ? { profile, errors } : { profile: null, errors: { form: 'invalid' } };
}
