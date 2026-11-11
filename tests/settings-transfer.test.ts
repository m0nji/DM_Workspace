import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  buildSettingsExport, defaultExportFileName, fromPortablePath, parseSettingsExport,
  serializeSettingsExport, SettingsImportError, toPortablePath
} from '../src/main/settings-transfer';
import { applySettingsImport, summarizeSettingsImport, type SettingsImportIds, type SettingsImportState } from '../src/renderer/settings-import';
import { createIdGenerator } from '../src/shared/ids';
import type { AgentProfile } from '../src/shared/agent-profiles';
import type { SettingsExportFile, SettingsExportPayload } from '../src/shared/types';

const profile: AgentProfile = {
  id: 'custom-review', adapter: 'claude', name: 'Claude Review',
  icon: { kind: 'letter', letter: 'R', color: '#c97b4a' },
  command: 'claude', args: ['--model', 'opus', '--add-dir', '/Users/alice/shared'],
  env: { ANTHROPIC_LOG: 'debug' }, showInMenu: true, startPrompt: 'Lies AGENTS.md'
};

function payload(): SettingsExportPayload {
  return {
    settings: {
      themeId: 'default', terminalOpacity: 0.9, workspaceNavigationPlacement: 'top', locale: 'de',
      agentProfiles: [profile], servers: [{ id: 'srv1', name: 'Büro', baseUrl: 'https://dmw.example' }],
      shortcutBindings: { commandPalette: 'Mod+K' }
    },
    workspaceTemplates: [{
      id: 'tpl1', name: 'Dev', cwd: '/Users/alice/Projects/app',
      layout: { type: 'split', id: 's1', direction: 'h', ratio: 0.5, children: [{ type: 'pane', id: 'p1' }, { type: 'pane', id: 'p2' }] },
      paneTitles: { p1: 'Server' }, startupCommands: { p1: 'npm run dev' }, confirmStartupCommands: true
    }],
    workspaces: [
      {
        id: 'w1', name: 'App', cwd: '/Users/alice/Projects/app', layout: { type: 'pane', id: 'p7' },
        paneTitles: { p7: 'Shell' }, pendingStartupCommands: { p7: 'rm -rf build' }, groupId: 'g1'
      },
      { id: 'w2', name: 'Remote', cwd: '~', layout: null, kind: 'remote', remote: { serverId: 'srv1', scope: 'user' } }
    ],
    workspaceGroups: [{ id: 'g1', name: 'Kunde', color: '#4a90c9' }]
  };
}

const exportMeta = { appVersion: '0.24.0', now: new Date('2026-11-11T10:00:00Z'), home: '/Users/alice', platform: 'darwin' as const };

function ids(): SettingsImportIds {
  return {
    pane: createIdGenerator('p'), split: createIdGenerator('s'), workspace: createIdGenerator('w'),
    template: createIdGenerator('tpl'), group: createIdGenerator('g'), server: createIdGenerator('srv')
  };
}

function seededIds(state: SettingsImportState): SettingsImportIds {
  const g = ids();
  (g.workspace as ReturnType<typeof createIdGenerator>).seed(state.workspaces.map((w) => w.id));
  (g.server as ReturnType<typeof createIdGenerator>).seed((state.settings.servers ?? []).map((s) => s.id));
  (g.template as ReturnType<typeof createIdGenerator>).seed(state.workspaceTemplates.map((t) => t.id));
  return g;
}

function freshMachine(): SettingsImportState {
  return {
    settings: { themeId: 'default', terminalOpacity: 0.95, workspaceNavigationPlacement: 'left' },
    workspaces: [{ id: 'w1', name: 'Workspace 1', cwd: '/home/bob', layout: null }],
    workspaceTemplates: [], workspaceGroups: [], activeWorkspaceId: 'w1'
  };
}

const ALL = { settings: true, templates: true, workspaces: true };

describe('portable paths', () => {
  it('writes paths under home as ~/… with forward slashes', () => {
    expect(toPortablePath('/Users/alice/Projects/app', '/Users/alice', 'darwin')).toBe('~/Projects/app');
    expect(toPortablePath('/Users/alice', '/Users/alice', 'darwin')).toBe('~');
    expect(toPortablePath('C:\\Users\\Alice\\Code\\x', 'c:\\users\\alice', 'win32')).toBe('~/Code/x');
  });

  it('leaves paths outside home and look-alike prefixes alone', () => {
    expect(toPortablePath('/opt/tools', '/Users/alice', 'darwin')).toBe('/opt/tools');
    expect(toPortablePath('/Users/alicex/app', '/Users/alice', 'darwin')).toBe('/Users/alicex/app');
  });

  it('turns ~/… into a path under the importing home', () => {
    expect(fromPortablePath('~/Projects/app', '/home/bob')).toBe(join('/home/bob', 'Projects', 'app'));
    expect(fromPortablePath('~', '/home/bob')).toBe('/home/bob');
    expect(fromPortablePath('/opt/tools', '/home/bob')).toBe('/opt/tools');
  });
});

describe('settings export', () => {
  it('round-trips agent profiles with all launch parameters', () => {
    const file = buildSettingsExport(payload(), exportMeta);
    const parsed = parseSettingsExport(serializeSettingsExport(file), '/home/bob');
    expect(parsed.settings.agentProfiles?.find((p) => p.id === 'custom-review')).toEqual(profile);
    expect(parsed.settings.shortcutBindings).toEqual({ commandPalette: 'Mod+K' });
    expect(parsed.settings.locale).toBe('de');
    expect(parsed.appVersion).toBe('0.24.0');
    expect(parsed.exportedAt).toBe('2026-11-11T10:00:00.000Z');
  });

  it('stores home paths portably and drops one-shot startup commands', () => {
    const file = buildSettingsExport(payload(), exportMeta);
    expect(file.workspaces[0].cwd).toBe('~/Projects/app');
    expect(file.workspaceTemplates[0].cwd).toBe('~/Projects/app');
    expect(file.workspaces[0].pendingStartupCommands).toBeUndefined();
    expect(file.workspaceTemplates[0].startupCommands).toEqual({ p1: 'npm run dev' });
  });

  it('never contains window bounds or tokens', () => {
    const text = serializeSettingsExport(buildSettingsExport(payload(), exportMeta));
    expect(text).not.toMatch(/windowBounds|token/i);
  });

  it('suggests a dated file name', () => {
    expect(defaultExportFileName(new Date(2026, 10, 1))).toBe('dm-workspace-settings-2026-11-01.json');
  });
});

describe('settings import parsing', () => {
  const code = (fn: () => unknown): string | undefined => {
    try { fn(); } catch (err) { return err instanceof SettingsImportError ? err.code : 'other'; }
    return undefined;
  };

  it('rejects files that are not settings exports', () => {
    expect(code(() => parseSettingsExport('not json', '/h'))).toBe('invalid');
    expect(code(() => parseSettingsExport('{"version":1,"workspaces":[]}', '/h'))).toBe('invalid');
    expect(code(() => parseSettingsExport('{"format":"dm-workspace-settings","formatVersion":1}', '/h'))).toBe('invalid');
  });

  it('reports files from a newer format version', () => {
    expect(code(() => parseSettingsExport('{"format":"dm-workspace-settings","formatVersion":2,"settings":{}}', '/h')))
      .toBe('unsupported-version');
  });

  it('drops invalid entries instead of failing the whole file', () => {
    const file = JSON.parse(serializeSettingsExport(buildSettingsExport(payload(), exportMeta))) as Record<string, unknown>;
    (file.settings as Record<string, unknown>).agentProfiles = [profile, { id: 'custom-bad', adapter: 'claude', env: { DMWS_NONCE: 'x' } }];
    (file.workspaces as unknown[]).push({ id: 'w9', name: '', cwd: '/x', layout: null });
    const parsed = parseSettingsExport(JSON.stringify(file), '/home/bob');
    expect(parsed.settings.agentProfiles?.map((p) => p.id)).toEqual(['claude', 'codex', 'opencode', 'custom-review']);
    expect(parsed.workspaces.map((w) => w.id)).toEqual(['w1', 'w2']);
  });

  it('accepts a UTF-8 BOM', () => {
    const text = `\uFEFF${serializeSettingsExport(buildSettingsExport(payload(), exportMeta))}`;
    expect(parseSettingsExport(text, '/home/bob').workspaces).toHaveLength(2);
  });
});

describe('applying an import', () => {
  const file = (): SettingsExportFile => parseSettingsExport(serializeSettingsExport(buildSettingsExport(payload(), exportMeta)), '/home/bob');

  it('summarizes what the file contains', () => {
    expect(summarizeSettingsImport(file())).toEqual({ agentProfiles: 4, servers: 1, templates: 1, workspaces: 2 });
  });

  it('brings everything onto a fresh machine and drops the empty welcome workspace', () => {
    const state = freshMachine();
    const out = applySettingsImport(state, file(), ALL, seededIds(state));
    expect(out.settings.agentProfiles?.find((p) => p.id === 'custom-review')).toEqual(profile);
    expect(out.settings.locale).toBe('de');
    expect(out.workspaces.map((w) => w.name)).toEqual(['App', 'Remote']);
    expect(out.workspaces[0].cwd).toBe(join('/home/bob', 'Projects', 'app'));
    expect(out.workspaces.some((w) => w.id === 'w1' && w.layout === null)).toBe(false);
    expect(out.activeWorkspaceId).toBe(out.workspaces[0].id);
    expect(out.addedServers).toEqual([{ id: 'srv1', name: 'Büro', baseUrl: 'https://dmw.example' }]);
    expect(out.workspaces[1].remote).toEqual({ serverId: 'srv1', scope: 'user' });
  });

  it('assigns fresh ids and remaps pane titles and groups', () => {
    const state: SettingsImportState = {
      ...freshMachine(),
      workspaces: [{ id: 'w1', name: 'Mine', cwd: '/home/bob', layout: { type: 'pane', id: 'p7' } }]
    };
    const g = seededIds(state);
    (g.pane as ReturnType<typeof createIdGenerator>).seed(['p7']);
    const out = applySettingsImport(state, file(), ALL, g);
    expect(out.workspaces.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    const app = out.workspaces[1];
    // p8/p9 gehen an die importierte Vorlage, die zuerst übernommen wird.
    expect(app.layout).toEqual({ type: 'pane', id: 'p10' });
    expect(app.paneTitles).toEqual({ p10: 'Shell' });
    expect(app.groupId).toBe(out.workspaceGroups[0].id);
    expect(out.workspaceGroups[0]).toMatchObject({ name: 'Kunde', color: '#4a90c9' });
    expect(out.activeWorkspaceId).toBe('w1');
  });

  it('keeps existing servers and never reuses a colliding server id for another URL', () => {
    const state: SettingsImportState = {
      ...freshMachine(),
      settings: { ...freshMachine().settings, servers: [{ id: 'srv1', name: 'Privat', baseUrl: 'https://other.example' }] }
    };
    const out = applySettingsImport(state, file(), ALL, seededIds(state));
    expect(out.settings.servers).toEqual([
      { id: 'srv1', name: 'Privat', baseUrl: 'https://other.example' },
      { id: 'srv2', name: 'Büro', baseUrl: 'https://dmw.example' }
    ]);
    expect(out.workspaces.find((w) => w.kind === 'remote')?.remote?.serverId).toBe('srv2');
  });

  it('maps a server with the same URL onto the existing entry', () => {
    const state: SettingsImportState = {
      ...freshMachine(),
      settings: { ...freshMachine().settings, servers: [{ id: 'srv4', name: 'Büro hier', baseUrl: 'https://dmw.example' }] }
    };
    const out = applySettingsImport(state, file(), ALL, seededIds(state));
    expect(out.addedServers).toEqual([]);
    expect(out.settings.servers).toEqual([{ id: 'srv4', name: 'Büro hier', baseUrl: 'https://dmw.example' }]);
    expect(out.workspaces.find((w) => w.kind === 'remote')?.remote?.serverId).toBe('srv4');
  });

  it('skips remote workspaces whose server is not imported', () => {
    const state = freshMachine();
    const out = applySettingsImport(state, file(), { settings: false, templates: false, workspaces: true }, seededIds(state));
    expect(out.workspaces.map((w) => w.name)).toEqual(['App']);
    expect(out.settings).toBe(state.settings);
    expect(out.addedServers).toEqual([]);
  });

  it('overwrites a template with the same name instead of duplicating it', () => {
    const state: SettingsImportState = {
      ...freshMachine(),
      workspaceTemplates: [{ id: 'tpl3', name: 'Dev', cwd: '/old', layout: { type: 'pane', id: 'p1' }, confirmStartupCommands: false }]
    };
    const out = applySettingsImport(state, file(), { settings: false, templates: true, workspaces: false }, seededIds(state));
    expect(out.workspaceTemplates).toHaveLength(1);
    expect(out.workspaceTemplates[0]).toMatchObject({ id: 'tpl3', name: 'Dev', cwd: join('/home/bob', 'Projects', 'app'), confirmStartupCommands: true });
    expect(Object.values(out.workspaceTemplates[0].startupCommands ?? {})).toEqual(['npm run dev']);
    expect(out.workspaces).toBe(state.workspaces);
  });

  it('does not duplicate workspaces when the same file is imported twice', () => {
    const state = freshMachine();
    const g = seededIds(state);
    const once = applySettingsImport(state, file(), ALL, g);
    const { addedServers: _ignored, ...afterFirst } = once;
    const twice = applySettingsImport(afterFirst, file(), ALL, g);
    expect(twice.workspaces.map((w) => w.name)).toEqual(['App', 'Remote']);
    expect(twice.workspaces).toEqual(once.workspaces);
    expect(twice.workspaceTemplates).toHaveLength(1);
  });

  it('skips a workspace that exists on the exporting machine itself', () => {
    const p = payload();
    const state: SettingsImportState = {
      settings: { ...p.settings },
      workspaces: p.workspaces.map((w) => ({ ...w, cwd: w.cwd.replace('/Users/alice', '/home/bob') })),
      workspaceTemplates: [], workspaceGroups: p.workspaceGroups, activeWorkspaceId: 'w1'
    };
    state.workspaces[0].cwd = join('/home/bob', 'Projects', 'app');
    state.workspaces[1].cwd = '/home/bob';
    const out = applySettingsImport(state, file(), { settings: false, templates: false, workspaces: true }, seededIds(state));
    expect(out.workspaces).toBe(state.workspaces);
  });

  it('still imports a workspace with the same name but another folder', () => {
    const state: SettingsImportState = {
      ...freshMachine(),
      workspaces: [{ id: 'w1', name: 'App', cwd: '/srv/other', layout: { type: 'pane', id: 'p1' } }]
    };
    const out = applySettingsImport(state, file(), { settings: false, templates: false, workspaces: true }, seededIds(state));
    expect(out.workspaces.map((w) => [w.name, w.cwd])).toEqual([['App', '/srv/other'], ['App', join('/home/bob', 'Projects', 'app')]]);
  });

  it('changes nothing when no part is selected', () => {
    const state = freshMachine();
    const out = applySettingsImport(state, file(), { settings: false, templates: false, workspaces: false }, seededIds(state));
    expect(out).toEqual({ ...state, addedServers: [] });
  });
});
