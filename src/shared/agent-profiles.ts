import type { AgentProvider } from './agent-state';

// Profiles describe how DM Workspace starts an agent CLI. The adapter decides
// hooks and status evidence; everything else (name, icon, program, arguments,
// environment) is user configuration. Arguments are stored as a list and only
// quoted for the actual shell at launch (src/main/agent-command.ts).
export type AgentAdapter = AgentProvider | 'generic';
export const AGENT_ADAPTERS: readonly AgentAdapter[] = ['claude', 'codex', 'opencode', 'generic'];
export type AgentLogoId = 'claude' | 'openai' | 'opencode' | 'ollama';
export const AGENT_LOGO_IDS: readonly AgentLogoId[] = ['claude', 'openai', 'opencode', 'ollama'];
export type AgentIcon =
  | { kind: 'logo'; logo: AgentLogoId }
  | { kind: 'letter'; letter: string; color: string };

export interface AgentProfile {
  id: string;
  adapter: AgentAdapter;
  name: string;
  icon: AgentIcon;
  command: string;
  args: string[];
  env: Record<string, string>;
  showInMenu: boolean;
  remoteControl?: boolean;
}

export const BUILTIN_PROFILE_IDS: readonly AgentProvider[] = ['claude', 'codex', 'opencode'];
const BUILTIN_NAMES: Record<AgentProvider, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
const BUILTIN_LOGOS: Record<AgentProvider, AgentLogoId> = { claude: 'claude', codex: 'openai', opencode: 'opencode' };
const MAX_ARGS = 64;
const MAX_ENV = 32;
const MAX_TEXT = 4096;
const CONTROL = /[\u0000-\u001f\u007f]/;
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CUSTOM_ID = /^custom-[a-z0-9-]{1,64}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isBuiltinProfileId(id: string): id is AgentProvider {
  return (BUILTIN_PROFILE_IDS as readonly string[]).includes(id);
}

export function builtinAgentProfile(id: AgentProvider): AgentProfile {
  return { id, adapter: id, name: BUILTIN_NAMES[id], icon: { kind: 'logo', logo: BUILTIN_LOGOS[id] }, command: id, args: [], env: {}, showInMenu: true };
}

export function builtinAgentProfiles(): AgentProfile[] {
  return BUILTIN_PROFILE_IDS.map(builtinAgentProfile);
}

export function supportsRemoteControl(adapter: AgentAdapter): adapter is 'claude' | 'codex' {
  return adapter === 'claude' || adapter === 'codex';
}

function cleanString(value: unknown, max: number, trim: boolean): string | null {
  if (typeof value !== 'string') return null;
  const s = trim ? value.trim() : value;
  if (!s || s.length > max || CONTROL.test(s)) return null;
  return s;
}

function parseIcon(raw: unknown): AgentIcon | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'logo') {
    return (AGENT_LOGO_IDS as readonly unknown[]).includes(raw.logo) ? { kind: 'logo', logo: raw.logo as AgentLogoId } : null;
  }
  if (raw.kind !== 'letter' || typeof raw.letter !== 'string' || typeof raw.color !== 'string') return null;
  const chars = Array.from(raw.letter.trim());
  if (chars.length !== 1 || CONTROL.test(chars[0]) || !/^#[0-9a-f]{6}$/i.test(raw.color)) return null;
  return { kind: 'letter', letter: chars[0], color: raw.color.toLowerCase() };
}

// The single validator for persisted settings, IPC payloads and the editor.
export function parseAgentProfile(raw: unknown): AgentProfile | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const id = raw.id;
  if (!isBuiltinProfileId(id) && !CUSTOM_ID.test(id)) return null;
  if (!(AGENT_ADAPTERS as readonly unknown[]).includes(raw.adapter)) return null;
  const adapter = raw.adapter as AgentAdapter;
  if (isBuiltinProfileId(id) && adapter !== id) return null;
  const name = cleanString(raw.name, 60, true);
  const command = cleanString(raw.command, 1024, true);
  const icon = parseIcon(raw.icon);
  if (!name || !command || !icon) return null;
  if (!Array.isArray(raw.args) || raw.args.length > MAX_ARGS) return null;
  const args: string[] = [];
  for (const arg of raw.args) {
    const s = cleanString(arg, MAX_TEXT, false);
    if (s === null) return null;
    args.push(s);
  }
  const envRaw = raw.env ?? {};
  if (!isRecord(envRaw)) return null;
  const entries = Object.entries(envRaw);
  if (entries.length > MAX_ENV) return null;
  const env: Record<string, string> = {};
  for (const [key, value] of entries) {
    // DMWS_* carries the hook nonce; a profile must never override it.
    if (!ENV_NAME.test(key) || /^DMWS_/i.test(key)) return null;
    if (typeof value !== 'string' || value.length > MAX_TEXT || CONTROL.test(value)) return null;
    env[key] = value;
  }
  const profile: AgentProfile = { id, adapter, name, icon, command, args, env, showInMenu: raw.showInMenu !== false };
  if (supportsRemoteControl(adapter) && typeof raw.remoteControl === 'boolean') profile.remoteControl = raw.remoteControl;
  return profile;
}

// Builtins always exist. Missing ones are added in default order in front; an
// edited builtin keeps its fields but can never change its adapter.
export function normalizeAgentProfiles(raw: unknown, legacyRemote: { claude?: boolean; codex?: boolean } = {}): AgentProfile[] {
  const out: AgentProfile[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    let forced: unknown;
    if (isRecord(item) && typeof item.id === 'string' && isBuiltinProfileId(item.id)) {
      forced = { ...item, adapter: item.id };
    } else {
      forced = item;
    }
    const profile = parseAgentProfile(forced);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    out.push(profile);
  }
  const missing = BUILTIN_PROFILE_IDS.filter(id => !seen.has(id)).map(id => {
    const profile = builtinAgentProfile(id);
    if (id !== 'opencode' && typeof legacyRemote[id] === 'boolean') profile.remoteControl = legacyRemote[id];
    return profile;
  });
  return [...missing, ...out];
}

export function resolveAgentProfiles(settings: { agentProfiles?: AgentProfile[]; agentRemoteControl?: { claude?: boolean; codex?: boolean } }): AgentProfile[] {
  return settings.agentProfiles
    ? normalizeAgentProfiles(settings.agentProfiles)
    : normalizeAgentProfiles([], settings.agentRemoteControl ?? {});
}

// 0.18.2 only knows agentRemoteControl. Writing it alongside keeps the phone
// option after a downgrade.
export function deriveAgentRemoteControl(profiles: AgentProfile[]): { claude?: boolean; codex?: boolean } {
  const out: { claude?: boolean; codex?: boolean } = {};
  for (const id of ['claude', 'codex'] as const) {
    const value = profiles.find(p => p.id === id)?.remoteControl;
    if (typeof value === 'boolean') out[id] = value;
  }
  return out;
}

export function customProfileFrom(base: AgentProfile, name: string, id = `custom-${crypto.randomUUID()}`): AgentProfile {
  return { ...base, id, name: name.slice(0, 60), args: [...base.args], env: { ...base.env } };
}

// Quote-aware split for the editor field. Outside quotes a backslash is
// literal (Windows paths); inside double quotes only \" and \\ are escapes.
export function splitArgs(input: string): string[] | null {
  const args: string[] = [];
  const chars = Array.from(input);
  let current = '';
  let inArg = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (quote === "'") { if (c === "'") quote = null; else current += c; continue; }
    if (quote === '"') {
      if (c === '\\' && (chars[i + 1] === '"' || chars[i + 1] === '\\')) { current += chars[++i]; continue; }
      if (c === '"') quote = null; else current += c;
      continue;
    }
    if (/\s/.test(c)) {
      if (inArg) { args.push(current); current = ''; inArg = false; }
      continue;
    }
    inArg = true;
    if (c === "'" || c === '"') quote = c; else current += c;
  }
  if (quote) return null;
  if (inArg) args.push(current);
  return args;
}

const BARE_ARG = /^[A-Za-z0-9_\-.,:/=@%+~\\]+$/;
export function joinArgs(args: string[]): string {
  return args.map(arg => BARE_ARG.test(arg) ? arg
    : !arg.includes("'") ? `'${arg}'`
    : `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(' ');
}

// Human-readable preview for the settings editor. The real launch command adds
// hooks and resolves the program; see src/main/agent-command.ts.
export function previewCommand(profile: AgentProfile, windows: boolean): string {
  const words = [profile.command, ...profile.args];
  if (windows) {
    // Typographic single quotes (U+2018-U+201B) end a PowerShell string too.
    const q = (s: string): string => /^[A-Za-z0-9_\-.,:/=@+~\\]+$/.test(s) ? s : `'${s.replace(/['\u2018-\u201B]/g, '$&$&')}'`;
    return Object.entries(profile.env).map(([k, v]) => `$env:${k}=${q(v)}; `).join('') + words.map(q).join(' ');
  }
  const q = (s: string): string => /^[A-Za-z0-9_\-.,:/=@+]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
  return Object.entries(profile.env).map(([k, v]) => `${k}=${q(v)} `).join('') + words.map(q).join(' ');
}
