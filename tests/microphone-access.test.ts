import { describe, expect, it, vi } from 'vitest';
import { createMicrophoneAccess } from '../src/main/microphone-access';
import type { MicrophoneAccess } from '../src/shared/types';

function fixture(platform: string, initial: Exclude<MicrophoneAccess, 'unsupported'>) {
  let status = initial;
  const services = {
    getMediaAccessStatus: vi.fn(() => status),
    askForMediaAccess: vi.fn(() => { status = 'granted'; return Promise.resolve(true); }),
    openExternal: vi.fn(() => Promise.resolve())
  };
  return { services, setStatus: (next: typeof status) => { status = next; }, access: createMicrophoneAccess(platform, services) };
}

describe('native terminal microphone consent', () => {
  it.each(['darwin', 'win32'])('checks %s without opening the microphone or prompting', async platform => {
    const { access, services } = fixture(platform, 'denied');
    expect(await access('status')).toBe('denied');
    expect(services.getMediaAccessStatus).toHaveBeenCalledWith('microphone');
    expect(services.askForMediaAccess).not.toHaveBeenCalled();
    expect(services.openExternal).not.toHaveBeenCalled();
  });

  it('asks for undetermined macOS consent once for simultaneous requests', async () => {
    const { access, services } = fixture('darwin', 'not-determined');
    services.askForMediaAccess.mockImplementation(() => Promise.resolve(true));
    expect(await Promise.all([access('request'), access('request')])).toEqual(['granted', 'granted']);
    expect(services.askForMediaAccess).toHaveBeenCalledTimes(1);
  });

  it.each(['granted', 'denied', 'restricted', 'unknown'] as const)('does not reprompt macOS with %s access', async status => {
    const { access, services } = fixture('darwin', status);
    expect(await access('request')).toBe(status);
    expect(services.askForMediaAccess).not.toHaveBeenCalled();
  });

  it('returns refusal from the OS and allows retry after a failed request', async () => {
    const { access, services } = fixture('darwin', 'not-determined');
    services.askForMediaAccess.mockRejectedValueOnce(new Error('unavailable'));
    await expect(access('request')).rejects.toThrow('unavailable');
    expect(await access('request')).toBe('granted');
    const denied = fixture('darwin', 'not-determined');
    denied.services.askForMediaAccess.mockImplementation(() => { denied.setStatus('denied'); return Promise.resolve(false); });
    expect(await denied.access('request')).toBe('denied');
    expect(denied.services.askForMediaAccess).toHaveBeenCalledOnce();
  });

  it.each(['not-determined', 'granted', 'denied', 'restricted', 'unknown'] as const)(
    'Windows request checks the desktop setting (%s), never calls the macOS API', async status => {
      const { access, services } = fixture('win32', status);
      expect(await access('request')).toBe(status);
      expect(services.askForMediaAccess).not.toHaveBeenCalled();
    });

  it.each([
    ['darwin', 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'],
    ['win32', 'ms-settings:privacy-microphone']
  ])('opens only the fixed %s microphone settings URI', async (platform, uri) => {
    const { access, services } = fixture(platform, 'denied');
    expect(await access('settings')).toBe('denied');
    expect(services.openExternal).toHaveBeenCalledExactlyOnceWith(uri);
    await expect(access('https://example.com')).rejects.toThrow('Invalid microphone action');
    expect(services.openExternal).toHaveBeenCalledTimes(1);
  });

  it('keeps unsupported platforms independent of Windows/macOS APIs', async () => {
    const { access, services } = fixture('linux', 'granted');
    for (const action of ['status', 'request', 'settings']) expect(await access(action)).toBe('unsupported');
    expect(services.getMediaAccessStatus).not.toHaveBeenCalled();
    expect(services.askForMediaAccess).not.toHaveBeenCalled();
    expect(services.openExternal).not.toHaveBeenCalled();
  });
});
