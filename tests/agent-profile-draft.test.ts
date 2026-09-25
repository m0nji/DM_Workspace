import { expect, it } from 'vitest';
import { fromDraft, toDraft } from '../src/renderer/agent-profile-draft';
import { builtinAgentProfile } from '../src/shared/agent-profiles';

const base = { id: 'custom-1', showInMenu: true };
const draft = { ...toDraft(builtinAgentProfile('opencode')), name: 'OpenCode (Ollama)', argsText: '--model ollama/qwen3-coder' };

it('round-trips a profile through the editor draft', () => {
  const profile = { ...builtinAgentProfile('codex'), args: ['--profile', 'o s'], env: { A: '1' }, remoteControl: true };
  expect(fromDraft({ id: 'codex', showInMenu: true }, toDraft(profile)).profile).toEqual(profile);
});
it('builds a valid custom profile from text fields and ignores empty env rows', () => {
  const { profile, errors } = fromDraft(base, { ...draft, env: [{ key: 'OLLAMA_HOST', value: 'http://localhost:11434' }, { key: '', value: '' }] });
  expect(errors).toEqual({});
  expect(profile).toMatchObject({ id: 'custom-1', args: ['--model', 'ollama/qwen3-coder'], env: { OLLAMA_HOST: 'http://localhost:11434' } });
});
it('reports field errors instead of a profile', () => {
  expect(fromDraft(base, { ...draft, name: ' ' }).errors).toMatchObject({ name: 'required' });
  expect(fromDraft(base, { ...draft, command: '' }).errors).toMatchObject({ command: 'required' });
  expect(fromDraft(base, { ...draft, argsText: '"open' }).errors).toMatchObject({ args: 'unclosed' });
  expect(fromDraft(base, { ...draft, argsText: "a ''" }).errors).toMatchObject({ args: 'empty' });
  expect(fromDraft(base, { ...draft, env: [{ key: 'DMWS_X', value: '1' }] }).errors).toMatchObject({ env: 'name' });
  expect(fromDraft(base, { ...draft, env: [{ key: 'A', value: '1' }, { key: 'A', value: '2' }] }).errors).toMatchObject({ env: 'duplicate' });
  expect(fromDraft(base, { ...draft, icon: { kind: 'letter', letter: '', color: '#000000' } }).errors).toMatchObject({ icon: 'letter' });
  expect(fromDraft(base, { ...draft, name: ' ' }).profile).toBeNull();
});
it('drops the phone option for adapters without remote control', () => {
  expect(fromDraft(base, { ...draft, adapter: 'generic', remoteControl: true }).profile).not.toHaveProperty('remoteControl');
});
