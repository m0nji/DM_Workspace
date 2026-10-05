// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MicrophoneSettings } from '../src/renderer/components/MicrophoneSettings';
import i18n from '../src/renderer/i18n';
import type { MicrophoneAccess } from '../src/shared/types';

let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function render(platform: string, status: MicrophoneAccess = 'not-determined') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const api = { platform, microphoneAccess: vi.fn((_action: string): Promise<MicrophoneAccess> => Promise.resolve(status)) };
  Object.defineProperty(window, 'api', { configurable: true, value: api });
  await i18n.changeLanguage('en');
  const host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(() => { root!.render(createElement(MicrophoneSettings)); return Promise.resolve(); });
  return api;
}
async function click(text: string): Promise<void> {
  const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent === text);
  expect(button).toBeDefined();
  await act(() => { button!.click(); return Promise.resolve(); });
}

describe('microphone settings', () => {
  it('requests macOS consent only on user action and updates after returning from system settings', async () => {
    const api = await render('darwin');
    expect(api.microphoneAccess.mock.calls).toEqual([['status']]);
    api.microphoneAccess.mockResolvedValue('granted');
    await click('Allow microphone access');
    expect(api.microphoneAccess).toHaveBeenLastCalledWith('request');
    expect(document.body.textContent).toContain('The system allows microphone access');
    expect(document.body.textContent).not.toContain('Allow microphone access');
    api.microphoneAccess.mockResolvedValue('denied');
    await act(() => { window.dispatchEvent(new Event('focus')); return Promise.resolve(); });
    expect(document.body.textContent).toContain('blocked in system settings');
    await click('Open microphone settings');
    expect(api.microphoneAccess).toHaveBeenLastCalledWith('settings');
  });

  it('gives Windows desktop microphone guidance without offering a macOS prompt', async () => {
    const api = await render('win32', 'denied');
    expect(document.body.textContent).toContain('Let desktop apps access your microphone');
    expect(document.body.textContent).not.toContain('Allow microphone access');
    await click('Open microphone settings');
    expect(api.microphoneAccess.mock.calls).toEqual([['status'], ['settings']]);
    api.microphoneAccess.mockResolvedValue('granted');
    await click('Check microphone access');
    expect(document.body.textContent).toContain('Check the input device and voice function');
  });

  it('keeps recovery controls available when the native API fails and translates them into German', async () => {
    const api = await render('win32', 'unknown');
    api.microphoneAccess.mockRejectedValue(new Error('unavailable'));
    await click('Check microphone access');
    expect(document.body.textContent).toContain('Could not check microphone permission');
    expect(Array.from(document.querySelectorAll('button')).every(b => !b.disabled)).toBe(true);
    await act(async () => { await i18n.changeLanguage('de'); });
    expect(document.body.textContent).toContain('Mikrofon-Einstellungen öffnen');
    expect(document.body.textContent).toContain('Desktop-Apps den Zugriff auf das Mikrofon erlauben');
  });
});
