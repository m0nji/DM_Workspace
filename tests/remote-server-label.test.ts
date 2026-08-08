import { describe, expect, it } from 'vitest';
import { remoteServerName } from '../src/renderer/remote-server-label';
import type { ServerConfig } from '../src/shared/types';

const servers: ServerConfig[] = [
  { id: 'srv1', name: 'home', baseUrl: 'https://ws-web.schwabe.info' }
];

describe('remoteServerName', () => {
  it('liefert den Namen des hinterlegten Servers', () => {
    expect(remoteServerName(servers, { serverId: 'srv1', scope: 'user' })).toBe('home');
  });

  it('liefert den Namen auch für Projekt-Referenzen', () => {
    expect(
      remoteServerName(servers, { serverId: 'srv1', scope: 'project', projectId: 'p1' })
    ).toBe('home');
  });

  it('liefert null, wenn der Server entfernt wurde', () => {
    expect(remoteServerName(servers, { serverId: 'weg', scope: 'user' })).toBeNull();
  });

  it('liefert null ohne Referenz', () => {
    expect(remoteServerName(servers, undefined)).toBeNull();
  });

  it('liefert null bei leerer Serverliste', () => {
    expect(remoteServerName([], { serverId: 'srv1', scope: 'user' })).toBeNull();
  });
});
