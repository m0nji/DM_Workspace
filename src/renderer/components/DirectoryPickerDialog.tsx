import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RemoteFsEntry } from '../../shared/types';
import { WORKSPACE_ROOT, toAbsPath, toFsPath, toWorkdir } from '../workdir-path';
import { Icon } from './Icon';

// Ordner-Browser für das Arbeitsverzeichnis eines geplanten Tasks. Das Feld war
// bisher ein blindes Textfeld: weder der Ausgangspunkt (/workspace) noch der
// Inhalt des Projekts waren sichtbar, ein Tippfehler fiel erst beim ersten
// fehlgeschlagenen Lauf auf.
//
// Gelistet werden ausschliesslich Verzeichnisse — Dateien sind für die Auswahl
// bedeutungslos und würden die Liste in einem echten Projekt unbrauchbar
// machen. Ausgewählt wird immer der GEÖFFNETE Ordner, nicht ein markierter
// Eintrag: so gibt es keinen Zustand „geöffnet ≠ ausgewählt", den man erklären
// müsste.

export interface DirectoryPickerDialogProps {
  serverId: string;
  projectId: string;
  /** Startort als Formularwert (relativ, '.' = Wurzel). */
  initialWorkdir: string;
  onSelect: (workdir: string) => void;
  onCancel: () => void;
}

export function DirectoryPickerDialog(
  { serverId, projectId, initialWorkdir, onSelect, onCancel }: DirectoryPickerDialogProps
): React.JSX.Element {
  const { t } = useTranslation();
  const [absPath, setAbsPath] = useState(() => toAbsPath(initialWorkdir));
  const [dirs, setDirs] = useState<string[] | null>(null); // null = lädt
  const [error, setError] = useState<string | null>(null);

  // Nur die jüngste Anfrage darf den Zustand schreiben: Zwei schnelle Klicks
  // auf verschiedene Ordner können in beliebiger Reihenfolge antworten, und
  // eine spät eintreffende ältere Antwort zeigte sonst einen anderen Ordner
  // an als den zuletzt angeklickten — „Diesen Ordner" übernähme den falschen.
  const requestId = useRef(0);

  // carriedError: Meldung eines vorausgegangenen Fehlversuchs, die den
  // Rückfall auf die Wurzel überleben soll (siehe unten) — ohne sie würde der
  // eigene setError(carriedError ?? null) dieses Aufrufs die gerade erst
  // gesetzte Meldung sofort wieder löschen, bevor sie je zu sehen war.
  const load = useCallback(async (target: string, carriedError?: string): Promise<void> => {
    const id = ++requestId.current;
    setDirs(null);
    setError(carriedError ?? null);
    const res = await window.api.remoteFsList(serverId, projectId, toFsPath(toWorkdir(target)));
    // Zwischen dem await und hier kann eine neuere Anfrage losgelaufen sein
    // (weiterer Klick) — dann gehört dieser Antwort kein Schreibrecht mehr,
    // weder auf den Erfolgs- noch auf den Fehlerpfad (inkl. Wurzel-Rückfall).
    if (id !== requestId.current) return;
    if (res.ok) {
      setDirs(res.entries.filter((e: RemoteFsEntry) => e.isDir).map((e) => e.name).sort((a, b) => a.localeCompare(b)));
      setAbsPath(target);
      // error bleibt auf dem oben gesetzten carriedError stehen (nicht auf
      // null zurückgesetzt) — eine getragene Meldung soll sichtbar bleiben,
      // bis der Nutzer selbst weiterklickt, nicht beim ersten Erfolg verschwinden.
      return;
    }
    // Die Servermeldung wörtlich, wenn eine mitkam — sie ist genauer als jeder
    // eigene Satz. Sonst der übersetzte Sammelfall.
    const message = res.message ?? t('tasks.scheduled.picker.error');
    setError(message);
    // Der Startort kann veraltet sein (Ordner gelöscht, Tippfehler im Feld).
    // Dann die Wurzel zeigen statt einen leeren Dialog ohne Ausweg — aber nur
    // einmal, sonst liefe ein defekter /workspace in eine Endlosschleife. Die
    // Meldung wird an den Rückfall durchgereicht, sonst verwirft dessen
    // eigener setError(carriedError ?? null) sie sofort wieder.
    if (target !== WORKSPACE_ROOT) { void load(WORKSPACE_ROOT, message); return; }
    setDirs([]);
  }, [serverId, projectId, t]);

  useEffect(() => { void load(toAbsPath(initialWorkdir)); }, [load, initialWorkdir]);

  const atRoot = absPath === WORKSPACE_ROOT;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal dirpicker-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t('tasks.scheduled.picker.title')}</span>
          <button type="button" className="modal-close" title={t('common.close')} onClick={onCancel}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="dirpicker-path mono">{absPath}</div>
        {error && <div className="setting-error">{error}</div>}
        <div className="dirpicker-list">
          {!atRoot && (
            <button
              type="button"
              className="dirpicker-entry"
              onClick={() => void load(absPath.slice(0, absPath.lastIndexOf('/')) || WORKSPACE_ROOT)}
            >
              <Icon name="back" size={14} />{t('tasks.scheduled.picker.parent')}
            </button>
          )}
          {dirs === null && <p className="modal-hint">{t('tasks.scheduled.picker.loading')}</p>}
          {dirs !== null && dirs.length === 0 && <p className="modal-hint">{t('tasks.scheduled.picker.empty')}</p>}
          {dirs?.map((name) => (
            <button
              key={name}
              type="button"
              className="dirpicker-entry"
              onClick={() => void load(`${absPath}/${name}`)}
            >
              <Icon name="folder" size={14} />{name}
            </button>
          ))}
        </div>
        <div className="tasks-form-footer">
          <button type="button" className="confirm-btn" onClick={onCancel}>{t('common.cancel')}</button>
          <button
            type="button"
            className="confirm-btn primary"
            onClick={() => onSelect(toWorkdir(absPath))}
          >{t('tasks.scheduled.picker.choose')}</button>
        </div>
      </div>
    </div>
  );
}
