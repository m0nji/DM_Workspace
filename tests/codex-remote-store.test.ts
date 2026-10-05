import { beforeEach, expect, it, vi } from 'vitest';
import { codexRemotePresentation, useCodexRemote } from '../src/renderer/codex-remote-store';
import { useStore } from '../src/renderer/store';

beforeEach(() => {
  vi.stubGlobal('window', { api: { saveState: vi.fn(() => Promise.resolve()), codexRemote: vi.fn() } });
  useStore.setState({ settings: { themeId: 'default', terminalOpacity: 1 } });
  useCodexRemote.setState({ snapshot: null, busy: null, error: null });
});

it('a failed disable keeps the confirmed permission and never persists an off state', async () => {
  useCodexRemote.setState({ snapshot: { status: 'running', remoteEnabled: true } });
  useStore.setState({ settings: { themeId: 'default', terminalOpacity: 1, codexRemoteAccess: true } });
  vi.mocked(window.api.codexRemote).mockResolvedValue({ status: 'error', reason: 'unavailable' });
  await useCodexRemote.getState().run('disable');
  expect(useCodexRemote.getState().snapshot?.remoteEnabled).toBe(true);
  expect(useStore.getState().settings.codexRemoteAccess).toBe(true);
  expect(window.api.saveState).not.toHaveBeenCalled();
});

it('serializes mutations and never keeps pairing credentials in the shared store', async () => {
  let finish!: (value: { status: 'paired-code'; code: string; expiresAt: string }) => void;
  vi.mocked(window.api.codexRemote).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const first = useCodexRemote.getState().run('pair');
  expect(await useCodexRemote.getState().run('disable')).toBeNull();
  finish({ status: 'paired-code', code: 'PRIVATE-CODE', expiresAt: '2099-01-01T00:00:00Z' });
  await first;
  expect(window.api.codexRemote).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(useCodexRemote.getState())).not.toContain('PRIVATE-CODE');
  expect(JSON.stringify(useStore.getState().settings)).not.toContain('PRIVATE-CODE');
});

it('does not equate daemon status or an unknown preference with a confirmed remote connection', () => {
  expect(codexRemotePresentation({ status: 'running', remoteEnabled: true }, null, null)).toBe('running');
  expect(codexRemotePresentation({ status: 'running', remoteEnabled: null }, null, null)).toBe('unknown');
  expect(codexRemotePresentation({ status: 'running', remoteEnabled: false, connected: true }, null, null)).toBe('off');
});
