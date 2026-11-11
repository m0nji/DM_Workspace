import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Export auf "Rechner A", Import auf einem frischen "Rechner B" (eigenes
// userData). Die nativen Datei-Dialoge ersetzt der E2E-Pfad in main/ipc.ts.
test('settings export from one profile imports agents and templates into a fresh one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-transfer-'));
  const exportFile = join(dir, 'export.json');
  const base = {
    ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1',
    DMWS_E2E_EXPORT_FILE: exportFile, DMWS_E2E_IMPORT_FILE: exportFile
  } as Record<string, string>;
  try {
    const a = await electron.launch({
      args: ['out/main/index.js', '--lang=en-US'],
      env: { ...base, DMWS_USERDATA: join(dir, 'a') }
    });
    try {
      const win = await a.firstWindow();
      await expect(win.locator('.welcome')).toBeVisible();
      await win.evaluate(() => {
        const s = window.__store.getState();
        s.setAgentProfiles([
          ...(s.settings.agentProfiles ?? []),
          {
            id: 'custom-e2e', adapter: 'claude', name: 'E2E Reviewer',
            icon: { kind: 'letter', letter: 'E', color: '#4a90c9' },
            command: 'claude', args: ['--model', 'opus'], env: { FOO: 'bar' }, showInMenu: true
          }
        ]);
        s.updateSettings({ terminalFontSize: 17 });
        s.setSettingsOpen(true, 'transfer');
      });
      await win.getByRole('button', { name: 'Export…', exact: true }).click();
      await expect(win.getByTestId('settings-export-status')).toHaveText('Saved as export.json');
    } finally { await a.close(); }

    const written = JSON.parse(readFileSync(exportFile, 'utf8')) as { format: string; appVersion: string; settings: { agentProfiles: { id: string; args: string[] }[] } };
    expect(written.format).toBe('dm-workspace-settings');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(written.appVersion).toBe(pkg.version);
    expect(written.settings.agentProfiles.find((p) => p.id === 'custom-e2e')?.args).toEqual(['--model', 'opus']);
    if (process.platform !== 'win32') expect(statSync(exportFile).mode & 0o777).toBe(0o600);

    const b = await electron.launch({
      args: ['out/main/index.js', '--lang=en-US'],
      env: { ...base, DMWS_USERDATA: join(dir, 'b') }
    });
    try {
      const win = await b.firstWindow();
      await expect(win.locator('.welcome')).toBeVisible();
      await win.evaluate(() => { window.__store.getState().setSettingsOpen(true, 'transfer'); });
      await win.getByRole('button', { name: 'Choose file…', exact: true }).click();
      const preview = win.getByTestId('settings-import-preview');
      await expect(preview).toContainText('export.json');
      await expect(win.getByLabel(/Settings incl\. AI agents \(4\)/)).toBeChecked();
      await win.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(win.getByTestId('settings-import-status')).toHaveText('Import complete.');

      const imported = await win.evaluate(() => {
        const s = window.__store.getState().settings;
        return { profile: s.agentProfiles?.find((p) => p.id === 'custom-e2e'), fontSize: s.terminalFontSize };
      });
      expect(imported.fontSize).toBe(17);
      expect(imported.profile).toMatchObject({ name: 'E2E Reviewer', args: ['--model', 'opus'], env: { FOO: 'bar' } });
    } finally { await b.close(); }

    // Übernommen heißt persistiert: state.json von B trägt das Profil.
    const stateB = readFileSync(join(dir, 'b', 'state.json'), 'utf8');
    expect(stateB).toContain('E2E Reviewer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
