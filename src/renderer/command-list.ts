import { collectPaneIds } from '../shared/layout-tree';
import { paneDisplayName } from './pane-display-name';
import type { TFunction } from 'i18next';
import { resolveShortcuts, formatShortcut, type ShortcutAction } from '../shared/shortcuts';
import { isRemotePaneKey } from '../shared/remote-pane-key';
import {
  REMOTE_MAX_PANES, remotePaneCloseBlock, remotePaneCreateBlock, tasksAvailable,
  type RemoteBlockReason, type RemoteConnectionState, type StoreState
} from './store';
import type { Workspace, WorkspaceGroup, WorkspaceTemplate } from '../shared/types';

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
  paneCwd: Record<string, string>;
  paneAutoTitles: Record<string, string>;
  workspaceGroups: WorkspaceGroup[];
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
  actions: s, workspaces, templates, workspaceGroups, activeWorkspaceId, focusedPaneId,
  shortcutBindings, remote, paneCwd, paneAutoTitles, t, isMac, close
}: CommandListInput): CommandItem[] {
  const bindings = resolveShortcuts(shortcutBindings, isMac);
  const hint = (a: ShortcutAction): string => formatShortcut(bindings[a], isMac);
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
  const act = (fn: () => void) => () => { close(); fn(); };
  // Eine namenlose Gruppe ist ein gültiger Zustand (direkt nach dem Anlegen) —
  // in einem Befehlstext wäre sie ohne Ersatzwort nicht benennbar. Dieselbe
  // Aushilfe wie am Chip in der Navigation.
  const groupLabel = (g: WorkspaceGroup): string => g.name || t('workspace.group.unnamed');
  const groupOf = (w: Workspace | undefined): WorkspaceGroup | undefined =>
    w?.groupId === undefined ? undefined : workspaceGroups.find((g) => g.id === w.groupId);

  const catActions = t('palette.group.actions');
  const catTemplates = t('palette.group.templates');
  const catWorkspaces = t('palette.group.workspaces');

  const list: CommandItem[] = [];

  // Tasks gibt es nur, wenn ein Server konfiguriert ist, der aktive Workspace
  // remote ist und der Server sie kann – dieselbe Funktion wie Panel und
  // Titelleiste, damit die drei nie auseinanderlaufen.
  if (tasksAvailable(s)) {
    list.push({
      id: 'tasks-open',
      title: t('palette.cmd.openTasks'),
      category: catActions,
      run: act(() => s.setTasksPanelOpen(true)),
    });
  }

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
      // Zwei Einträge statt einem: die Richtung entscheidet, wo die neue
      // Server-Pane im lokalen Layout einsortiert wird — dieselbe Wahl wie beim
      // lokalen Split, deshalb auch dieselben Tastenkürzel.
      const createReason = reason(remotePaneCreateBlock(remote, focusedPaneId));
      list.push(
        {
          id: 'new-remote-terminal-right',
          title: t('palette.cmd.newRemoteTerminalRight'),
          subtitle: createReason,
          category: catActions,
          hint: hint('splitHorizontal'),
          run: act(() => s.createRemotePane(focusedPaneId, 'h'))
        },
        {
          id: 'new-remote-terminal-below',
          title: t('palette.cmd.newRemoteTerminalBelow'),
          subtitle: createReason,
          category: catActions,
          hint: hint('splitVertical'),
          run: act(() => s.createRemotePane(focusedPaneId, 'v'))
        }
      );
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
    // Fokuswechsel zwischen Panes: dieselbe Sichtbarkeitsregel wie die
    // uebrigen Pane-Aktionen (nur bei fokussiertem Pane, lokal wie remote).
    list.push(
      { id: 'focus-pane-left', title: t('palette.cmd.focusPaneLeft'), category: catActions, hint: hint('focusPaneLeft'), run: act(() => s.focusPaneInDirection('left')) },
      { id: 'focus-pane-right', title: t('palette.cmd.focusPaneRight'), category: catActions, hint: hint('focusPaneRight'), run: act(() => s.focusPaneInDirection('right')) },
      { id: 'focus-pane-up', title: t('palette.cmd.focusPaneUp'), category: catActions, hint: hint('focusPaneUp'), run: act(() => s.focusPaneInDirection('up')) },
      { id: 'focus-pane-down', title: t('palette.cmd.focusPaneDown'), category: catActions, hint: hint('focusPaneDown'), run: act(() => s.focusPaneInDirection('down')) }
    );
  }

  // Register-Gruppen. Das Gruppieren selbst bleibt bewusst eine Drag-Geste: es
  // braucht immer ein zweites Register als Ziel, und ein Palettentext ohne
  // Zielauswahl müsste sich eines aussuchen — dieselbe Begründung, mit der die
  // Spec ein Tastenkürzel fürs Gruppieren ablehnt. Die Palette übernimmt die
  // Verwaltung und den Beitritt zu einer BESTEHENDEN Gruppe, wo das Ziel im
  // Eintrag selbst steht.
  const activeGroup = groupOf(activeWs);
  if (activeWs && activeGroup) {
    const name = groupLabel(activeGroup);
    const collapsed = activeGroup.collapsed ?? false;
    list.push(
      {
        id: 'group-collapse',
        title: collapsed ? t('palette.cmd.expandGroup', { name }) : t('palette.cmd.collapseGroup', { name }),
        category: catActions,
        run: act(() => s.setWorkspaceGroupCollapsed(activeGroup.id, !collapsed))
      },
      {
        // Umbenennen braucht eine Eingabe, die die Palette nicht hat: der
        // Eintrag setzt deshalb nur das Ziel und überlässt die Eingabe dem
        // Inline-Editor am Chip — derselbe Weg, den 'search' zum Pane nimmt.
        // Ohne das ließe sich eine Gruppe per Tastatur anlegen und auflösen,
        // aber nie benennen, und namenlos ist ihr Anfangszustand.
        id: 'group-rename',
        title: t('palette.cmd.renameGroup', { name }),
        category: catActions,
        run: act(() => s.setRenamingGroup(activeGroup.id))
      },
      {
        id: 'group-leave',
        title: t('palette.cmd.leaveGroup', { name }),
        // Herauslösen verschiebt sichtbar: aus der Mitte eines Laufs kann das
        // Register nicht liegen bleiben, ohne die Gruppe zu zerreißen. Es in
        // der Unterzeile zu sagen ist ehrlicher, als es geschehen zu lassen.
        subtitle: t('palette.cmd.leaveGroupHint'),
        category: catActions,
        run: act(() => s.ungroupWorkspace(activeWs.id))
      },
      {
        id: 'group-dissolve',
        title: t('palette.cmd.dissolveGroup', { name }),
        category: catActions,
        run: act(() => s.dissolveWorkspaceGroup(activeGroup.id))
      }
    );
  }
  if (activeWs) {
    // Ein Eintrag je Gruppe statt eines Eintrags mit Zielauswahl: so steht das
    // Ziel im Text und die Palette braucht keinen zweiten Schritt.
    workspaceGroups.forEach((g) => {
      if (g.id === activeWs.groupId) return;
      list.push({
        id: `group-join-${g.id}`,
        title: t('palette.cmd.joinGroup', { name: groupLabel(g) }),
        category: catActions,
        run: act(() => s.dropWorkspaceTab(activeWs.id, { kind: 'group', id: g.id }, 'into'))
      });
    });
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
    // Zwei gleich benannte Workspaces sind in der Liste sonst nicht
    // auseinanderzuhalten; die Gruppe steht deshalb mit in der Unterzeile und
    // ist auch suchbar, damit "backend" alle Mitglieder findet.
    const group = groupOf(w);
    const inGroup = group ? t('palette.cmd.inGroup', { name: groupLabel(group) }) : undefined;
    list.push({
      id: `switch-${w.id}`,
      title: t('palette.cmd.switchToWorkspace', { name: w.name }),
      subtitle: inGroup ? `${inGroup} · ${w.cwd}` : w.cwd,
      category: catWorkspaces,
      // Mod+1..9 jumps to the workspace at that position in the sidebar.
      hint: idx < 9 ? formatShortcut(`Mod+${idx + 1}`, isMac) : undefined,
      keywords: group ? `${w.cwd} ${groupLabel(group)}` : w.cwd,
      run: act(() => s.selectWorkspace(w.id))
    });
  });

  workspaces.forEach((w) => {
    const group = groupOf(w);
    collectPaneIds(w.layout).forEach((paneId, index) => {
      const cwd = paneCwd[paneId] ?? w.cwd;
      const manual = w.paneTitles?.[paneId] ?? '';
      const automatic = paneAutoTitles[paneId] ?? '';
      const position = t('palette.paneNumber', { number: index + 1 });
      list.push({
        id: `pane-${w.id}-${paneId}`,
        title: paneDisplayName(manual || automatic, cwd) || position,
        subtitle: [w.name, group ? groupLabel(group) : '', position, cwd].filter(Boolean).join(' · '),
        category: t('palette.group.panes'),
        keywords: `${automatic} ${w.cwd}`,
        run: act(() => s.revealPane(w.id, paneId))
      });
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
