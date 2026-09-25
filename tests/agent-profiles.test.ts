import { describe, expect, it } from 'vitest';
import {
  builtinAgentProfile, builtinAgentProfiles, customProfileFrom, deriveAgentRemoteControl, joinArgs,
  normalizeAgentProfiles, parseAgentProfile, previewCommand, resolveAgentProfiles, splitArgs,
  type AgentProfile
} from '../src/shared/agent-profiles';

const ollama: AgentProfile = {
  id: 'custom-1234', adapter: 'opencode', name: 'OpenCode (Ollama)',
  icon: { kind: 'letter', letter: 'O', color: '#c97b4a' }, command: 'opencode',
  args: ['--model', 'ollama/qwen3-coder'], env: { OLLAMA_HOST: 'http://localhost:11434' }, showInMenu: true
};

describe('parseAgentProfile', () => {
  it('accepts a valid custom profile and drops unknown fields', () => {
    expect(parseAgentProfile({ ...ollama, extra: 1 })).toEqual(ollama);
  });
  it('rejects wrong ids, builtin adapter changes and bad icons', () => {
    expect(parseAgentProfile({ ...ollama, id: 'mine' })).toBeNull();
    expect(parseAgentProfile({ ...builtinAgentProfile('claude'), adapter: 'generic' })).toBeNull();
    expect(parseAgentProfile({ ...ollama, icon: { kind: 'letter', letter: 'AB', color: '#000000' } })).toBeNull();
    expect(parseAgentProfile({ ...ollama, icon: { kind: 'letter', letter: 'A', color: 'red' } })).toBeNull();
    expect(parseAgentProfile({ ...ollama, icon: { kind: 'logo', logo: 'gemini' } })).toBeNull();
  });
  it('rejects empty names/commands, control characters, empty and too many arguments', () => {
    expect(parseAgentProfile({ ...ollama, name: '  ' })).toBeNull();
    expect(parseAgentProfile({ ...ollama, command: '' })).toBeNull();
    expect(parseAgentProfile({ ...ollama, command: 'open\ncode' })).toBeNull();
    expect(parseAgentProfile({ ...ollama, args: [''] })).toBeNull();
    expect(parseAgentProfile({ ...ollama, args: Array(65).fill('x') })).toBeNull();
  });
  it('rejects invalid and reserved environment names but allows empty values', () => {
    expect(parseAgentProfile({ ...ollama, env: { '1X': 'a' } })).toBeNull();
    expect(parseAgentProfile({ ...ollama, env: { DMWS_AGENT_NONCE: 'a' } })).toBeNull();
    expect(parseAgentProfile({ ...ollama, env: { dmws_x: 'a' } })).toBeNull();
    expect(parseAgentProfile({ ...ollama, env: { EMPTY: '' } })?.env).toEqual({ EMPTY: '' });
  });
  it('keeps remoteControl only for claude and codex adapters', () => {
    expect(parseAgentProfile({ ...ollama, remoteControl: true })).not.toHaveProperty('remoteControl');
    expect(parseAgentProfile({ ...builtinAgentProfile('codex'), remoteControl: true })?.remoteControl).toBe(true);
  });
  it('trims name and command, but never arguments or values', () => {
    const parsed = parseAgentProfile({ ...ollama, name: ' X ', command: ' opencode ', args: [' spaced '], env: { A: ' v ' } });
    expect(parsed).toMatchObject({ name: 'X', command: 'opencode', args: [' spaced '], env: { A: ' v ' } });
  });
});

describe('normalizeAgentProfiles and resolveAgentProfiles', () => {
  it('adds missing builtins in default order in front, keeps custom order, drops duplicates', () => {
    const out = normalizeAgentProfiles([ollama, { ...ollama, name: 'dup' }, builtinAgentProfile('codex')]);
    expect(out.map(p => p.id)).toEqual(['claude', 'opencode', 'custom-1234', 'codex']);
    expect(out.find(p => p.id === 'custom-1234')?.name).toBe('OpenCode (Ollama)');
  });
  it('forces the builtin adapter instead of dropping an edited builtin', () => {
    const out = normalizeAgentProfiles([{ ...builtinAgentProfile('claude'), adapter: 'generic', name: 'Mein Claude' }]);
    expect(out.map(p => p.id)).toEqual(['codex', 'opencode', 'claude']);
    expect(out.find(p => p.id === 'claude')).toMatchObject({ adapter: 'claude', name: 'Mein Claude' });
  });
  it('resolves legacy phone settings into builtins only when no profiles were saved', () => {
    const legacy = resolveAgentProfiles({ agentRemoteControl: { claude: true, codex: false } });
    expect(legacy.map(p => [p.id, p.remoteControl])).toEqual([['claude', true], ['codex', false], ['opencode', undefined]]);
    const saved = resolveAgentProfiles({ agentProfiles: [builtinAgentProfile('claude')], agentRemoteControl: { claude: true } });
    expect(saved[0].remoteControl).toBeUndefined();
  });
  it('derives the legacy phone settings from builtins', () => {
    const profiles = builtinAgentProfiles();
    profiles[0].remoteControl = true;
    expect(deriveAgentRemoteControl(profiles)).toEqual({ claude: true });
  });
  it('round-trips an already complete array with identical order and content', () => {
    const input = [...builtinAgentProfiles(), ollama];
    const out = normalizeAgentProfiles(input);
    expect(out).toEqual(input);
  });
});

describe('customProfileFrom', () => {
  it('copies a profile under a new custom id without sharing arrays', () => {
    const copy = customProfileFrom(builtinAgentProfile('opencode'), 'OpenCode (Kopie)');
    expect(copy.id).toMatch(/^custom-[a-z0-9-]+$/);
    expect(parseAgentProfile(copy)).toEqual(copy);
    copy.args.push('x');
    expect(builtinAgentProfile('opencode').args).toEqual([]);
  });
});

describe('splitArgs and joinArgs', () => {
  it('splits on whitespace and honours single and double quotes', () => {
    expect(splitArgs(`--model ollama/qwen3 'it''s' "a \\"b\\" c" x\\y`)).toEqual(['--model', 'ollama/qwen3', 'its', 'a "b" c', 'x\\y']);
  });
  it('keeps Windows backslashes outside quotes literal', () => {
    expect(splitArgs('--config C:\\Users\\me\\x.json')).toEqual(['--config', 'C:\\Users\\me\\x.json']);
  });
  it('reports an unclosed quote as null and keeps an explicit empty argument', () => {
    expect(splitArgs(`"open`)).toBeNull();
    expect(splitArgs(`''`)).toEqual(['']);
  });
  it('round-trips every argument', () => {
    const args = ['plain', 'with space', "it's", 'say "hi"', 'back\\slash', 'Grüße', 'C:\\Program Files\\x', '$HOME', 'a"b\'c'];
    expect(splitArgs(joinArgs(args))).toEqual(args);
  });
});

describe('previewCommand', () => {
  it('shows POSIX and PowerShell forms without hooks', () => {
    expect(previewCommand(ollama, false)).toBe('OLLAMA_HOST=http://localhost:11434 opencode --model ollama/qwen3-coder');
    expect(previewCommand({ ...ollama, args: ["it's"] }, false)).toBe(`OLLAMA_HOST=http://localhost:11434 opencode 'it'\\''s'`);
    expect(previewCommand({ ...ollama, args: ["it's"] }, true)).toBe(`$env:OLLAMA_HOST=http://localhost:11434; opencode 'it''s'`);
  });
  it('doubles typographic single quotes in the PowerShell form', () => {
    expect(previewCommand({ ...ollama, env: { NOTE: 'a\u2018b' }, args: ['it\u2019s', '\u201Ax\u201B'] }, true))
      .toBe(`$env:NOTE='a\u2018\u2018b'; opencode 'it\u2019\u2019s' '\u201A\u201Ax\u201B\u201B'`);
  });
});
