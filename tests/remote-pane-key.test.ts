import { describe, expect, it } from 'vitest';
import {
  USER_SCOPE_KEY, isRemotePaneKey, parseRemotePaneKey, remotePaneKey,
  remoteScopeFromKey, remoteScopeKey
} from '../src/shared/remote-pane-key';

describe('remote-pane-key', () => {
  it('round-trips build and parse', () => {
    const key = remotePaneKey('srv1', 'proj-uuid', 'p1');
    expect(key).toBe('r:srv1:proj-uuid:p1');
    expect(isRemotePaneKey(key)).toBe(true);
    expect(parseRemotePaneKey(key)).toEqual({ serverId: 'srv1', scopeKey: 'proj-uuid', remotePaneId: 'p1' });
  });

  // User-Runtime-Panes (Phase D): scopeKey ist der reservierte Bezeichner
  // 'user' — Namespace r:<serverId>:user:<paneId>.
  it('round-trips a user-scope pane key', () => {
    const key = remotePaneKey('srv1', USER_SCOPE_KEY, 'p1');
    expect(key).toBe('r:srv1:user:p1');
    expect(parseRemotePaneKey(key)).toEqual({ serverId: 'srv1', scopeKey: 'user', remotePaneId: 'p1' });
  });

  it('maps SpawnTargetScope to scopeKey and back', () => {
    expect(remoteScopeKey({ kind: 'user' })).toBe(USER_SCOPE_KEY);
    expect(remoteScopeKey({ kind: 'project', projectId: 'proj-uuid' })).toBe('proj-uuid');
    expect(remoteScopeFromKey(USER_SCOPE_KEY)).toEqual({ kind: 'user' });
    expect(remoteScopeFromKey('proj-uuid')).toEqual({ kind: 'project', projectId: 'proj-uuid' });
  });

  it('lokale Pane-Ids sind keine Remote-Schlüssel', () => {
    expect(isRemotePaneKey('p1')).toBe(false);
    expect(parseRemotePaneKey('p1')).toBeNull();
  });

  // Beim Parsen wird von links getrennt: ein ':' in der Server-Pane-Id bleibt
  // Teil der remotePaneId.
  it('keeps colons inside the remote pane id', () => {
    expect(parseRemotePaneKey('r:s:p:a:b')).toEqual({ serverId: 's', scopeKey: 'p', remotePaneId: 'a:b' });
  });

  it('rejects malformed keys', () => {
    expect(parseRemotePaneKey('r:')).toBeNull();
    expect(parseRemotePaneKey('r:s')).toBeNull();
    expect(parseRemotePaneKey('r:s:p')).toBeNull();
    expect(parseRemotePaneKey('r:s:p:')).toBeNull();
    expect(parseRemotePaneKey('r::p:x')).toBeNull();
  });
});
