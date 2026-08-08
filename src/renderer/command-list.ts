import type { TFunction } from 'i18next';
import { resolveShortcuts, formatShortcut, type ShortcutAction } from '../shared/shortcuts';
import { isRemotePaneKey } from '../shared/remote-pane-key';
import {
  REMOTE_MAX_PANES, remotePaneCloseBlock, remotePaneCreateBlock,
  type RemoteBlockReason, type RemoteConnectionState, type StoreState
} from './store';
import type { Workspace, WorkspaceTemplate } from '../shared/types';

export interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;   // shown muted under the title
  category: string;    // grouping label, e.g. 'Actions' / 'Workspaces' / 'Templates'
  hint?: string;       // right-aligned kbd hint (a formatted shortcut)
  keywords?: string;   // extra searchable text
  run: () => void;
}

// Übersetzung wird hereingereicht statt importiert — so lässt sich die Funktion
// ohne React und ohne jsdom testen (wie remote-server-label.ts).
export type Translate = TFunction;

// Die gelesenen Daten stehen einzeln in der Signatur (nicht nur als
// Momentaufnahme des Stores): Sie sind zugleich die Liste der Felder, auf die
// die Palette abonniert sein muss, damit die Liste aktuell bleibt.
export interface CommandListInput {
  actions: StoreState;               // die Aktionen, die run() auslöst
  workspaces: Workspace[];
  templates: WorkspaceTemplate[];
  activeWorkspaceId: string | null;
  focusedPaneId: string | null;
  shortcutBindings: Partial<Record<ShortcutAction, string>> | undefined;
  remote: Record<string, RemoteConnectionState>;
  t: Translate;
  isMac: boolean;
  close: () => void;                 // Palette schließen, bevor die Aktion läuft
}

// Baut die Befehlsliste der Palette. Bewusst außerhalb der Komponente: hier
// steckt die gesamte Fallunterscheidung lokal/remote, und genau die war bisher
// die einzige Verzweigung dieses Arbeitspakets ohne Test.
export function buildCommandList({
  actions: s, workspaces, templates, activeWorkspaceId, focusedPaneId,
  shortcutBindings, remote, t, isMac, close
}: CommandListInput): CommandItem[] {
  const bindings = resolveShortcuts(shortcutBindings, isMac);
  const hint = (a: ShortcutAction): string => formatShortcut(bindings[a], isMac);
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
  const act = (fn: () => void) => () => { close(); fn(); };

  const catActions = t('palette.group.actions');
  const catTemplates = t('palette.group.templates');
  const catWorkspaces = t('palette.group.workspaces');

  const list: CommandItem[] = [];

  list.push({ id: 'new-workspace', title: t('palette.cmd.newWorkspace'), category: catActions, hint: hint('newWorkspace'), run: act(() => s.addWorkspace()) });

  if (focusedPaneId) {
    // Split ist ein Konzept des lokalen Layouts und bleibt auf Remote-Panes
    // verboten (der Store verwirft splitActivePane dort ohnehin); das Remote-
    // Äquivalent von "Bereich hinzufügen" ist ein neues Terminal im
    // Projekt-Container, keine Aufteilung des vorhandenen Panes.
    const remotePane = isRemotePaneKey(focusedPaneId);
    // Gesperrte Remote-Aktionen bleiben sichtbar, nennen aber den Grund in der
    // Unterzeile — ein Eintrag, der beim Auslösen nichts tut, wäre genau das
    // stille Nichts, das dieses Arbeitspaket abschafft.
    const reason = (blocked: RemoteBlockReason | null): string | undefined =>
      blocked ? t(`pane.remoteBlocked.${blocked}`, { max: REMOTE_MAX_PANES }) : undefined;
    if (remotePane) {
      list.push({
        id: 'new-remote-terminal',
        title: t('palette.cmd.newRemoteTerminal'),
        subtitle: reason(remotePaneCreateBlock(remote, focusedPaneId)),
        category: catActions,
        run: act(() => s.createRemotePane(focusedPaneId))
      });
    } else {
      list.push(
        { id: 'split-h', title: t('palette.cmd.splitHorizontal'), category: catActions, hint: hint('splitHorizontal'), run: act(() => s.splitActivePane(focusedPaneId, 'h')) },
        { id: 'split-v', title: t('palette.cmd.splitVertical'), category: catActions, hint: hint('splitVertical'), run: act(() => s.splitActivePane(focusedPaneId, 'v')) }
      );
    }
    list.push(
      { id: 'maximize', title: t('palette.cmd.toggleMaximize'), category: catActions, hint: hint('toggleMaximize'), run: act(() => s.toggleMaximize(focusedPaneId)) },
      { id: 'search', title: t('palette.cmd.searchPane'), category: catActions, hint: hint('searchPane'), run: act(() => s.setSearchOpen(focusedPaneId)) },
      // Schließen läuft über requestClosePane — lokal wie remote mit derselben
      // Rückfrage wie der Knopf im Pane-Kopf.
      {
        id: 'close-pane',
        title: t('palette.cmd.closePane'),
        subtitle: remotePane ? reason(remotePaneCloseBlock(remote, focusedPaneId)) : undefined,
        category: catActions,
        hint: hint('closePane'),
        run: act(() => s.requestClosePane(focusedPaneId))
      }
    );
  }

  list.push(
    { id: 'toggle-preview', title: t('palette.cmd.togglePreview'), category: catActions, hint: hint('togglePreview'), run: act(() => s.togglePreview()) },
    { id: 'open-file-browser', title: t('palette.cmd.openFileBrowser'), category: catActions, run: act(() => s.openFiles()) },
    { id: 'open-settings', title: t('palette.cmd.openSettings'), category: catActions, hint: hint('openSettings'), run: act(() => s.setSettingsOpen(true)) },
    { id: 'open-shortcuts', title: t('palette.cmd.openShortcuts'), category: catActions, keywords: 'keybindings rebind', run: act(() => s.setSettingsOpen(true, 'shortcuts')) }
  );

  if (activeWs?.layout) {
    list.push({ id: 'save-template', title: t('palette.cmd.saveTemplate'), category: catTemplates, run: act(() => s.setTemplateWizard({ open: true, templateId: null })) });
  }

  workspaces.forEach((w, idx) => {
    if (w.id === activeWorkspaceId) return;
    list.push({
      id: `switch-${w.id}`,
      title: t('palette.cmd.switchToWorkspace', { name: w.name }),
      subtitle: w.cwd,
      category: catWorkspaces,
      // Mod+1..9 jumps to the workspace at that position in the sidebar.
      hint: idx < 9 ? formatShortcut(`Mod+${idx + 1}`, isMac) : undefined,
      keywords: w.cwd,
      run: act(() => s.selectWorkspace(w.id))
    });
  });

  templates.forEach((tpl) => {
    // requestTemplateLaunch closes the palette itself (it may instead open the
    // confirm dialog), so it is NOT wrapped in act() to avoid a double-close.
    list.push({ id: `tpl-run-${tpl.id}`, title: t('palette.cmd.newFromTemplate', { name: tpl.name }), subtitle: tpl.cwd, category: catTemplates, run: () => s.requestTemplateLaunch(tpl.id) });
    list.push({ id: `tpl-edit-${tpl.id}`, title: t('palette.cmd.editTemplate', { name: tpl.name }), category: catTemplates, run: act(() => s.setTemplateWizard({ open: true, templateId: tpl.id })) });
    list.push({ id: `tpl-del-${tpl.id}`, title: t('palette.cmd.deleteTemplate', { name: tpl.name }), category: catTemplates, run: act(() => s.deleteWorkspaceTemplate(tpl.id)) });
  });

  return list;
}
