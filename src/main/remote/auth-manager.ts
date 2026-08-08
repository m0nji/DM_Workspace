// Session-Verwaltung für Workspace-Server (Remote-Workspaces-Plan, 4.1).
//
// Pro Server liegt genau ein Session-Token (der Wert des dmw_session-Cookies)
// via Electron safeStorage verschlüsselt in einer EIGENEN Datei unter userData
// — bewusst nicht in state.json, die der Renderer liest und komplett
// zurückschreibt. Tokens verlassen den Main-Prozess nie: nach außen gehen nur
// angemeldet/abgemeldet plus Nutzername.
//
// Alle Electron-Abhängigkeiten (safeStorage, shell.openExternal) und fetch
// sind injizierbar, damit die Klasse ohne Electron testbar ist; die Verdrahtung
// mit den echten Implementierungen passiert in ipc.ts.

import { readFileSync } from 'node:fs';
import { writeFileAtomic } from '../atomic-write';
import type {
  DevicePairingResult, RemoteAuthStatus, RemoteLoginResult, RemoteUser
} from '../../shared/types';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface AuthManagerDeps {
  /** Ablageort der verschlüsselten Tokens (userData/remote-auth.json). */
  file: string;
  safeStorage: SafeStorageLike;
  openExternal: (url: string) => void;
  fetchFn?: typeof fetch;
  /** Test-Override: ersetzt die pollIntervalSec-Wartezeit der Gerätekopplung. */
  pollIntervalMsOverride?: number;
}

interface DeviceStartResponse {
  deviceCode?: string;
  verifyUrl?: string;
  expiresInSec?: number;
  pollIntervalSec?: number;
}

function asUser(raw: unknown): RemoteUser | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.username !== 'string') return undefined;
  return {
    username: r.username,
    displayName: typeof r.displayName === 'string' && r.displayName ? r.displayName : r.username
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AuthManager {
  // In-Memory-Cache der Klartext-Tokens. Quelle der Wahrheit ist die Datei;
  // der Cache erspart das Entschlüsseln bei jedem WS-Connect. Ist safeStorage
  // nicht verfügbar (Linux ohne Keyring), leben Tokens NUR hier — dann ist
  // nach einem Neustart eine neue Anmeldung nötig, aber nie ein Klartext-Token
  // auf der Platte.
  private readonly tokens = new Map<string, string>();
  private loaded = false;

  constructor(private readonly deps: AuthManagerDeps) {}

  private get fetchFn(): typeof fetch {
    return this.deps.fetchFn ?? fetch;
  }

  private loadOnce(): void {
    if (this.loaded) return;
    this.loaded = true;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.deps.file, 'utf8'));
    } catch {
      return; // Datei fehlt/kaputt -> keine gespeicherten Sessions
    }
    if (typeof raw !== 'object' || raw === null) return;
    if (!this.deps.safeStorage.isEncryptionAvailable()) return;
    for (const [serverId, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      try {
        this.tokens.set(serverId, this.deps.safeStorage.decryptString(Buffer.from(value, 'base64')));
      } catch {
        // Schlüsselbund gewechselt o. ä. — Eintrag ist wertlos, still verwerfen.
      }
    }
  }

  private persist(): void {
    if (!this.deps.safeStorage.isEncryptionAvailable()) return; // nur in-memory
    const out: Record<string, string> = {};
    for (const [serverId, token] of this.tokens) {
      out[serverId] = this.deps.safeStorage.encryptString(token).toString('base64');
    }
    try {
      // 0600 wie state.json/scrollback.json: nur der Besitzer liest die Datei.
      writeFileAtomic(this.deps.file, JSON.stringify(out, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error('[auth] failed to persist session store:', err);
    }
  }

  /** Klartext-Token für den Cookie-Header — nur für Main-internen Gebrauch. */
  token(serverId: string): string | null {
    this.loadOnce();
    return this.tokens.get(serverId) ?? null;
  }

  /** `Cookie:`-Headerwert für REST-Aufrufe und den WS-Upgrade, oder null. */
  cookieHeader(serverId: string): string | null {
    const token = this.token(serverId);
    return token ? `dmw_session=${token}` : null;
  }

  private setToken(serverId: string, token: string | null): void {
    this.loadOnce();
    if (token === null) this.tokens.delete(serverId);
    else this.tokens.set(serverId, token);
    this.persist();
  }

  /** Beim Entfernen eines Servers dessen gespeicherte Session mitlöschen. */
  forget(serverId: string): void {
    this.setToken(serverId, null);
  }

  // Direkter Login mit Benutzername/Passwort (nur lokale Server-Konten).
  // Der Token kommt als Set-Cookie-Header zurück (dmw_session=<token>).
  async loginLocal(baseUrl: string, serverId: string, username: string, password: string): Promise<RemoteLoginResult> {
    let res: Response;
    try {
      res = await this.fetchFn(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
    } catch (err) {
      return { ok: false, error: `Server nicht erreichbar: ${err instanceof Error ? err.message : String(err)}` };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` };
    }
    const token = extractSessionCookie(res);
    if (!token) return { ok: false, error: 'Server hat kein Session-Cookie gesetzt' };
    this.setToken(serverId, token);
    return { ok: true, user: asUser(body.user) };
  }

  // Gerätekopplung (Device Authorization Grant, Plan 4.1): Start beim Server,
  // verifyUrl im Systembrowser öffnen, dann pollen bis der Nutzer bestätigt
  // hat. Der Server liefert das Session-Token GENAU EINMAL ('consumed' bei
  // jedem weiteren Poll desselben Codes).
  async startDevicePairing(baseUrl: string, serverId: string): Promise<DevicePairingResult> {
    let start: DeviceStartResponse;
    try {
      const res = await this.fetchFn(`${baseUrl}/api/auth/device/start`, { method: 'POST' });
      if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
      start = (await res.json()) as DeviceStartResponse;
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    if (!start.deviceCode || !start.verifyUrl) return { status: 'error', message: 'Unerwartete Server-Antwort' };

    this.deps.openExternal(start.verifyUrl);

    const pollMs = this.deps.pollIntervalMsOverride ?? Math.max(1, start.pollIntervalSec ?? 5) * 1000;
    const deadline = Date.now() + (start.expiresInSec ?? 300) * 1000;
    while (Date.now() < deadline) {
      await delay(pollMs);
      let res: Response;
      try {
        res = await this.fetchFn(`${baseUrl}/api/auth/device/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceCode: start.deviceCode })
        });
      } catch {
        continue; // transienter Netzfehler -> weiterpollen bis zur Deadline
      }
      if (res.status === 429) continue; // zu schnell -> nächstes Intervall abwarten
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (body.status === 'pending') continue;
      if (body.status === 'ok' && typeof body.sessionToken === 'string') {
        this.setToken(serverId, body.sessionToken);
        // Nutzerdaten nachladen — rein informativ, ein Fehler ist kein Abbruch.
        const status = await this.status(baseUrl, serverId).catch(() => null);
        return { status: 'ok', user: status?.loggedIn ? status.user : undefined };
      }
      if (body.status === 'expired' || body.status === 'consumed') {
        return { status: body.status };
      }
      return { status: 'error', message: typeof body.error === 'string' ? body.error : 'Unerwartete Server-Antwort' };
    }
    return { status: 'expired' };
  }

  // Serverseitige Session beenden UND den lokalen Token löschen. Der lokale
  // Teil passiert auch, wenn der Server nicht erreichbar ist.
  async logout(baseUrl: string, serverId: string): Promise<void> {
    const cookie = this.cookieHeader(serverId);
    this.setToken(serverId, null);
    if (!cookie) return;
    try {
      await this.fetchFn(`${baseUrl}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
    } catch {
      // Session läuft serverseitig ohnehin ab; lokal ist sie bereits weg.
    }
  }

  // Validiert die gespeicherte Session gegen einen authentifizierten Endpoint
  // (/api/me). 401 = Token abgelaufen -> lokal aufräumen.
  async status(baseUrl: string, serverId: string): Promise<RemoteAuthStatus> {
    const cookie = this.cookieHeader(serverId);
    if (!cookie) return { loggedIn: false };
    let res: Response;
    try {
      res = await this.fetchFn(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    } catch {
      // Server nicht erreichbar: Token behalten (er kann noch gültig sein),
      // aber der UI nichts Falsches versprechen.
      return { loggedIn: false };
    }
    if (res.status === 401) {
      this.setToken(serverId, null);
      return { loggedIn: false };
    }
    if (!res.ok) return { loggedIn: false };
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const user = asUser(body.user);
    return user ? { loggedIn: true, user } : { loggedIn: false };
  }
}

// Zieht den dmw_session-Wert aus den Set-Cookie-Headern einer Response.
// getSetCookie() gibt es in Undici/Electron-Main; der Fallback über get()
// deckt Test-Doubles ab, die nur eine einfache Header-Map stellen.
export function extractSessionCookie(res: Response): string | null {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie') ?? ''];
  for (const cookie of cookies) {
    const m = /(?:^|;\s*)dmw_session=([^;]+)/.exec(cookie);
    if (m) return m[1];
  }
  return null;
}
