import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

test('kennzeichnet Remote-Workspaces in der Seitenleiste', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'dmws-remote-marker-'));
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'state.json'), JSON.stringify({
    version: 1,
    workspaces: [
      { id: 'w1', name: 'Lokal', cwd: '/tmp', layout: null },
      { id: 'w2', name: 'Projekt', cwd: '/tmp', layout: null,
        kind: 'remote', remote: { serverId: 'srv1', scope: 'project', projectId: 'p1' } },
      { id: 'w3', name: 'Verwaist', cwd: '/tmp', layout: null,
        kind: 'remote', remote: { serverId: 'weg', scope: 'user' } }
    ],
    workspaceTemplates: [],
    activeWorkspaceId: 'w1',
    settings: { servers: [{ id: 'srv1', name: 'home', baseUrl: 'https://example.invalid' }] }
  }));

  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_USERDATA: userData, DMWS_DISABLE_WEBGL: '1' }
  });
  const win = await app.firstWindow();
  await win.waitForSelector('.root[data-brand-design]');

  const local = win.locator('.ws-item', { hasText: 'Lokal' });
  const project = win.locator('.ws-item', { hasText: 'Projekt' });
  const orphan = win.locator('.ws-item', { hasText: 'Verwaist' });

  await expect(local).not.toHaveClass(/remote/);
  await expect(local.locator('.ws-sub')).toHaveCount(0);

  await expect(project).toHaveClass(/remote/);
  await expect(project.locator('.ws-sub')).toHaveText('home');

  // Auch der verwaiste Workspace bleibt ein Remote-Workspace: die Klasse hängt
  // an w.kind, nicht daran, ob sich die serverId noch auflösen lässt.
  await expect(orphan).toHaveClass(/remote/);
  await expect(orphan.locator('.ws-sub')).toHaveText('Server removed');
  await expect(orphan.locator('.ws-sub')).toHaveClass(/missing/);

  await app.close();
});
