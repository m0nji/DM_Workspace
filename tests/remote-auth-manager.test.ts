import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthManager, extractSessionCookie, type SafeStorageLike } from '../src/main/remote/auth-manager';

// safeStorage-Double: „Verschlüsselung" = Base64 mit Präfix — genug, um zu
// prüfen, dass nie der Klartext-Token auf der Platte landet.
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b) => {
      const raw = b.toString('utf8');
      if (!raw.startsWith('enc:')) throw new Error('bad ciphertext');
      return raw.slice(4);
    }
  };
}

function jsonResponse(status: number, body: unknown, setCookie?: string): Response {
  const headers = new Headers();
  if (setCookie) headers.set('set-cookie', setCookie);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: () => Promise.resolve(body)
  } as unknown as Response;
}

function tempFile(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-auth-'));
  return { file: join(dir, 'remote-auth.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const BASE = 'https://dmw.example';

describe('AuthManager', () => {
  it('loginLocal speichert den Session-Token verschlüsselt (nie im Klartext auf der Platte)', async () => {
    const { file, cleanup } = tempFile();
    try {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(
        200,
        { user: { username: 'karl', displayName: 'Karl' } },
        'dmw_session=SECRET-TOKEN; Path=/; HttpOnly'
      ));
      const auth = new AuthManager({
        file, safeStorage: fakeSafeStorage(), openExternal: vi.fn(), fetchFn: fetchFn as unknown as typeof fetch
      });

      const result = await auth.loginLocal(BASE, 'srv1', 'karl', 'pw');
      expect(result).toEqual({ ok: true, user: { username: 'karl', displayName: 'Karl' } });
      expect(fetchFn).toHaveBeenCalledWith(`${BASE}/api/login`, expect.objectContaining({ method: 'POST' }));
      expect(auth.cookieHeader('srv1')).toBe('dmw_session=SECRET-TOKEN');

      const onDisk = readFileSync(file, 'utf8');
      expect(onDisk).not.toContain('SECRET-TOKEN');

      // Neue Instanz liest denselben Stand zurück (Persistenz + Entschlüsselung).
      const again = new AuthManager({
        file, safeStorage: fakeSafeStorage(), openExternal: vi.fn(), fetchFn: fetchFn as unknown as typeof fetch
      });
      expect(again.cookieHeader('srv1')).toBe('dmw_session=SECRET-TOKEN');
    } finally {
      cleanup();
    }
  });

  it('loginLocal reicht die Fehlermeldung des Servers durch', async () => {
    const { file, cleanup } = tempFile();
    try {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Anmeldung fehlgeschlagen' }));
      const auth = new AuthManager({
        file, safeStorage: fakeSafeStorage(), openExternal: vi.fn(), fetchFn: fetchFn as unknown as typeof fetch
      });
      expect(await auth.loginLocal(BASE, 'srv1', 'karl', 'falsch')).toEqual({
        ok: false, error: 'Anmeldung fehlgeschlagen'
      });
      expect(auth.cookieHeader('srv1')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('ohne verfügbares safeStorage bleiben Tokens nur im Speicher', async () => {
    const { file, cleanup } = tempFile();
    try {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { user: { username: 'k' } }, 'dmw_session=T'));
      const auth = new AuthManager({
        file, safeStorage: fakeSafeStorage(false), openExternal: vi.fn(), fetchFn: fetchFn as unknown as typeof fetch
      });
      await auth.loginLocal(BASE, 'srv1', 'k', 'pw');
      expect(auth.cookieHeader('srv1')).toBe('dmw_session=T');
      expect(() => readFileSync(file, 'utf8')).toThrow(); // Datei wurde nie geschrieben
    } finally {
      cleanup();
    }
  });

  it('Gerätekopplung: öffnet verifyUrl, pollt pending -> ok und speichert den Token', async () => {
    const { file, cleanup } = tempFile();
    try {
      const openExternal = vi.fn();
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, {
          deviceCode: 'DEV', verifyUrl: `${BASE}/device?code=USER`, expiresInSec: 300, pollIntervalSec: 5
        }))
        .mockResolvedValueOnce(jsonResponse(200, { status: 'pending' }))
        .mockResolvedValueOnce(jsonResponse(200, { status: 'ok', sessionToken: 'PAIRED-TOKEN' }))
        // status()-Aufruf nach erfolgreicher Kopplung:
        .mockResolvedValueOnce(jsonResponse(200, { user: { username: 'karl', displayName: 'Karl' } }));
      const auth = new AuthManager({
        file, safeStorage: fakeSafeStorage(), openExternal,
        fetchFn: fetchFn as unknown as typeof fetch, pollIntervalMsOverride: 1
      });

      const result = await auth.startDevicePairing(BASE, 'srv1');
      expect(openExternal).toHaveBeenCalledWith(`${BASE}/device?code=USER`);
      expect(result).toEqual({ status: 'ok', user: { username: 'karl', displayName: 'Karl' } });
      expect(auth.cookieHeader('srv1')).toBe('dmw_session=PAIRED-TOKEN');
      // Poll-Payload trägt den deviceCode.
      expect(fetchFn).toHaveBeenNthCalledWith(2, `${BASE}/api/auth/device/poll`, expect.objectContaining({
        body: JSON.stringify({ deviceCode: 'DEV' })
      }));
    } finally {
      cleanup();
    }
  });

  it('Gerätekopplung: expired beendet den Poll ohne Token', async () => {
    const { file, cleanup } = tempFile();
    try {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, {
          deviceCode: 'DEV', verifyUrl: `${BASE}/device?code=U`, expiresInSec: 300, pollIntervalSec: 5
        }))
        .mockResolvedValueOnce(jsonResponse(200, { status: 'pending' }))
        .mockResolvedValueOnce(jsonResponse(200, { status: 'expired' }));
      const auth = new AuthManager({
        file, safeStorage: fakeSafeStorage(), openExternal: vi.fn(),
        fetchFn: fetchFn as unknown as typeof fetch, pollIntervalMsOverride: 1
      });
      expect(await auth.startDevicePairing(BASE, 'srv1')).toEqual({ status: 'expired' });
      expect(auth.cookieHeader('srv1')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('Gerätekopplung: lokale Deadline greift, wenn der Server dauerhaft pending liefert', async () => {
    const { file, cleanup } = tempFile();
    try {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, {
          deviceCode: 'DEV', verifyUrl: `${BASE}/device?code=U`, expiresInSec: 0, pollIntervalSec: 5
        }));
      const auth = new AuthManager({
        file, safeStorage: fakeSafeStorage(), openExternal: vi.fn(),
        fetchFn: fetchFn as unknown as typeof fetch, pollIntervalMsOverride: 1
      });
      expect(await auth.startDevicePairing(BASE, 'srv1')).toEqual({ status: 'expired' });
      expect(fetchFn).toHaveBeenCalledTimes(1); // nie gepollt — sofort abgelaufen
    } finally {
      cleanup();
    }
  });

  it('logout löscht den Token lokal und ruft den Server mit dem Cookie auf', async () => {
    const { file, cleanup } = tempFile();
    try {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, { user: { username: 'k' } }, 'dmw_session=T'))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      const auth = new AuthManager({
        file, safeStorage: fakeSafeStorage(), openExternal: vi.fn(), fetchFn: fetchFn as unknown as typeof fetch
      });
      await auth.loginLocal(BASE, 'srv1', 'k', 'pw');
      await auth.logout(BASE, 'srv1');
      expect(auth.cookieHeader('srv1')).toBeNull();
      expect(fetchFn).toHaveBeenLastCalledWith(`${BASE}/api/logout`, expect.objectContaining({
        method: 'POST', headers: { Cookie: 'dmw_session=T' }
      }));
      expect(readFileSync(file, 'utf8')).not.toContain('T');
    } finally {
      cleanup();
    }
  });

  it('status: 401 räumt den gespeicherten Token auf', async () => {
    const { file, cleanup } = tempFile();
    try {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, { user: { username: 'k' } }, 'dmw_session=T'))
        .mockResolvedValueOnce(jsonResponse(401, { error: 'Nicht angemeldet' }));
      const auth = new AuthManager({
        file, safeStorage: fakeSafeStorage(), openExternal: vi.fn(), fetchFn: fetchFn as unknown as typeof fetch
      });
      await auth.loginLocal(BASE, 'srv1', 'k', 'pw');
      expect(await auth.status(BASE, 'srv1')).toEqual({ loggedIn: false });
      expect(auth.cookieHeader('srv1')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('status ohne Token fragt den Server gar nicht erst', async () => {
    const { file, cleanup } = tempFile();
    try {
      const fetchFn = vi.fn();
      const auth = new AuthManager({
        file, safeStorage: fakeSafeStorage(), openExternal: vi.fn(), fetchFn: fetchFn as unknown as typeof fetch
      });
      expect(await auth.status(BASE, 'srv1')).toEqual({ loggedIn: false });
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});

describe('extractSessionCookie', () => {
  it('findet dmw_session in getSetCookie-Listen', () => {
    const headers = new Headers();
    const res = { headers: Object.assign(headers, {
      getSetCookie: () => ['other=x; Path=/', 'dmw_session=abc123; Path=/; HttpOnly']
    }) } as unknown as Response;
    expect(extractSessionCookie(res)).toBe('abc123');
  });

  it('gibt null zurück, wenn kein Session-Cookie gesetzt wurde', () => {
    const res = { headers: new Headers() } as unknown as Response;
    expect(extractSessionCookie(res)).toBeNull();
  });
});
