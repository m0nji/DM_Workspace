import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { useStore } from '../store';
import { describeIpcError } from '../ipc-error';
import { summarizeSettingsImport } from '../settings-import';
import type { SettingsExportFile, SettingsImportParts, SettingsImportResult } from '../../shared/types';

type ImportErrorCode = Exclude<SettingsImportResult, { ok: true }>['code'];

const IMPORT_ERRORS: Record<Exclude<ImportErrorCode, 'canceled'>, ParseKeys> = {
  unreadable: 'settings.transfer.errorUnreadable',
  'too-large': 'settings.transfer.errorTooLarge',
  invalid: 'settings.transfer.errorInvalid',
  'unsupported-version': 'settings.transfer.errorNewerVersion'
};

type Status = { kind: 'ok' | 'error'; text: string } | null;

interface PendingImport { fileName: string; file: SettingsExportFile; parts: SettingsImportParts }

// Einstellungen sichern & übertragen: alles, was man auf einem Rechner
// eingerichtet hat (vor allem KI-Agenten mit ihren Startparametern), in eine
// Datei schreiben und auf einem anderen Rechner wieder einlesen.
export function SettingsTransferSection(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const importSettingsFile = useStore((s) => s.importSettingsFile);
  const [busy, setBusy] = useState(false);
  const [exportStatus, setExportStatus] = useState<Status>(null);
  const [importStatus, setImportStatus] = useState<Status>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);

  const runExport = async (): Promise<void> => {
    setBusy(true);
    setExportStatus(null);
    try {
      const s = useStore.getState();
      const res = await window.api.exportSettings({
        settings: s.settings,
        workspaceTemplates: s.workspaceTemplates ?? [],
        workspaces: s.workspaces,
        workspaceGroups: s.workspaceGroups ?? []
      });
      if (res.ok) setExportStatus({ kind: 'ok', text: t('settings.transfer.exported', { file: res.fileName }) });
      else if (res.code === 'write-failed') setExportStatus({ kind: 'error', text: t('settings.transfer.errorWrite') });
    } catch (err) {
      setExportStatus({ kind: 'error', text: describeIpcError(err) });
    } finally {
      setBusy(false);
    }
  };

  const pickImport = async (): Promise<void> => {
    setBusy(true);
    setImportStatus(null);
    try {
      const res = await window.api.importSettings();
      if (res.ok) {
        const summary = summarizeSettingsImport(res.file);
        setPending({
          fileName: res.fileName,
          file: res.file,
          parts: { settings: true, templates: summary.templates > 0, workspaces: summary.workspaces > 0 }
        });
      } else if (res.code !== 'canceled') {
        setImportStatus({ kind: 'error', text: t(IMPORT_ERRORS[res.code]) });
      }
    } catch (err) {
      setImportStatus({ kind: 'error', text: describeIpcError(err) });
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = (): void => {
    if (!pending) return;
    importSettingsFile(pending.file, pending.parts);
    setPending(null);
    setImportStatus({ kind: 'ok', text: t('settings.transfer.imported') });
  };

  const summary = pending ? summarizeSettingsImport(pending.file) : null;
  const exportedAt = pending?.file.exportedAt ? new Date(pending.file.exportedAt) : null;
  const exportedAtText = exportedAt && !Number.isNaN(exportedAt.getTime())
    ? exportedAt.toLocaleString(i18n.language)
    : t('settings.transfer.unknown');
  const setPart = (part: keyof SettingsImportParts, value: boolean): void =>
    setPending((p) => (p ? { ...p, parts: { ...p.parts, [part]: value } } : p));
  const anySelected = !!pending && (pending.parts.settings || pending.parts.templates || pending.parts.workspaces);

  return (
    <>
      <div className="settings-group">
        <div className="modal-section-label">{t('settings.transfer.exportTitle')}</div>
        <p className="modal-hint" style={{ marginTop: 0 }}>{t('settings.transfer.exportHint')}</p>
        <div className="setting-row">
          <span className="update-status" role="status" data-testid="settings-export-status">
            {exportStatus && <span className={exportStatus.kind === 'error' ? 'transfer-error' : undefined}>{exportStatus.text}</span>}
          </span>
          <button className="cwd-btn" onClick={() => { void runExport(); }} disabled={busy}>
            {t('settings.transfer.exportButton')}
          </button>
        </div>
        <p className="modal-hint">{t('settings.transfer.exportSecretsHint')}</p>
      </div>

      <div className="settings-group">
        <div className="modal-section-label">{t('settings.transfer.importTitle')}</div>
        {!pending && (
          <>
            <p className="modal-hint" style={{ marginTop: 0 }}>{t('settings.transfer.importHint')}</p>
            <div className="setting-row">
              <span className="update-status" role="status" data-testid="settings-import-status">
                {importStatus && <span className={importStatus.kind === 'error' ? 'transfer-error' : undefined}>{importStatus.text}</span>}
              </span>
              <button className="cwd-btn" onClick={() => { void pickImport(); }} disabled={busy}>
                {t('settings.transfer.importButton')}
              </button>
            </div>
          </>
        )}
        {pending && summary && (
          <div className="transfer-preview" data-testid="settings-import-preview">
            <p className="modal-hint" style={{ marginTop: 0 }}>
              {t('settings.transfer.fileInfo', { file: pending.fileName, date: exportedAtText, version: pending.file.appVersion || t('settings.transfer.unknown') })}
            </p>
            <div className="setting-row">
              <label htmlFor="import-part-settings">
                {t('settings.transfer.partSettings', { agents: summary.agentProfiles, servers: summary.servers })}
              </label>
              <input id="import-part-settings" type="checkbox" checked={pending.parts.settings}
                onChange={(e) => setPart('settings', e.target.checked)} />
            </div>
            <div className="setting-row">
              <label htmlFor="import-part-templates">{t('settings.transfer.partTemplates', { count: summary.templates })}</label>
              <input id="import-part-templates" type="checkbox" checked={pending.parts.templates}
                disabled={summary.templates === 0} onChange={(e) => setPart('templates', e.target.checked)} />
            </div>
            <div className="setting-row">
              <label htmlFor="import-part-workspaces">{t('settings.transfer.partWorkspaces', { count: summary.workspaces })}</label>
              <input id="import-part-workspaces" type="checkbox" checked={pending.parts.workspaces}
                disabled={summary.workspaces === 0} onChange={(e) => setPart('workspaces', e.target.checked)} />
            </div>
            <p className="modal-hint">{t('settings.transfer.importRules')}</p>
            <p className="modal-hint">{t('settings.transfer.importTrustHint')}</p>
            <div className="setting-row transfer-actions">
              <button className="cwd-btn" onClick={() => setPending(null)}>{t('settings.transfer.cancel')}</button>
              <button className="cwd-btn" onClick={confirmImport} disabled={!anySelected}>
                {t('settings.transfer.confirmImport')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
