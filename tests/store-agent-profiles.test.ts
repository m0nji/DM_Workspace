import { beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/store';
import { builtinAgentProfiles, customProfileFrom, resolveAgentProfiles } from '../src/shared/agent-profiles';
import { DEFAULT_THEME_ID } from '../src/shared/themes';

beforeEach(() => {
  vi.stubGlobal('window', { api: { saveState: vi.fn(() => Promise.resolve()) } });
  useStore.setState({ settings: { themeId: DEFAULT_THEME_ID, terminalOpacity: 1, agentRemoteControl: { codex: true } } });
});

it('resolves legacy phone settings before any profile was saved', () => {
  const codex = resolveAgentProfiles(useStore.getState().settings).find(p => p.id === 'codex');
  expect(codex?.remoteControl).toBe(true);
});

it('stores normalized profiles and keeps agentRemoteControl in sync for downgrades', () => {
  const profiles = builtinAgentProfiles();
  profiles[0].remoteControl = true;
  const custom = customProfileFrom(profiles[2], 'OpenCode (Ollama)');
  useStore.getState().setAgentProfiles([...profiles, custom, { ...custom, command: '' }]);
  const settings = useStore.getState().settings;
  expect(settings.agentProfiles?.map(p => p.id)).toEqual(['claude', 'codex', 'opencode', custom.id]);
  expect(settings.agentRemoteControl).toEqual({ claude: true });
  expect(window.api.saveState).toHaveBeenCalled();
});

it('opens the agents settings focused on one profile', () => {
  useStore.getState().openAgentSettings('custom-x');
  expect(useStore.getState()).toMatchObject({ settingsOpen: true, settingsFocusSection: 'agents', agentSettingsFocus: 'custom-x' });
});
