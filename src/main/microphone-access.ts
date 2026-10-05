import type { MicrophoneAccess } from '../shared/types';

interface MicrophoneServices {
  getMediaAccessStatus(type: 'microphone'): Exclude<MicrophoneAccess, 'unsupported'>;
  askForMediaAccess(type: 'microphone'): Promise<boolean>;
  openExternal(url: string): Promise<void>;
}

// Native terminal children access audio directly, outside Chromium's session
// permission handlers. Only check/request OS consent here; never record audio.
export function createMicrophoneAccess(platform: string, services: MicrophoneServices) {
  let request: Promise<MicrophoneAccess> | null = null;
  const status = (): MicrophoneAccess => {
    if (platform !== 'darwin' && platform !== 'win32') return 'unsupported';
    return services.getMediaAccessStatus('microphone');
  };
  return async (action: unknown): Promise<MicrophoneAccess> => {
    if (action !== 'status' && action !== 'request' && action !== 'settings') {
      throw new Error('Invalid microphone action');
    }
    if (action === 'settings') {
      const url = platform === 'darwin'
        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
        : platform === 'win32' ? 'ms-settings:privacy-microphone' : null;
      if (url) await services.openExternal(url);
    }
    // Windows desktop apps use the global privacy setting, with no per-app
    // consent prompt. askForMediaAccess exists only on macOS.
    if (action !== 'request' || platform !== 'darwin' || status() !== 'not-determined') return status();
    request ??= services.askForMediaAccess('microphone')
      .then(granted => granted ? 'granted' as const : status())
      .finally(() => { request = null; });
    return request;
  };
}
