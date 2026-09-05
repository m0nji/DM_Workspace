import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { useStore } from '../store';
import { getTheme } from '../../shared/themes';
import { createPaneActivity } from '../pane-activity';
import { registerSearch, unregisterSearch } from '../search-registry';
import {
  registerTerminal, unregisterTerminal, clearTerminal, clearTerminals, refreshTerminalLayoutAfterCommit,
  registerTerminalFocus, unregisterTerminalFocus,
  registerTerminalLayoutRefresh, unregisterTerminalLayoutRefresh,
  registerTerminalInputTracking, unregisterTerminalInputTracking
} from '../terminal-registry';
import { parseOsc7, parseOsc9 } from '../../shared/osc-cwd';
import { stripTrailingWhitespace, selectionAsCommand } from '../../shared/copy-text';
import { collectPaneIds } from '../../shared/layout-tree';
// Eigenständige Terminal-Belange: jedes Modul hält Auf- und Abbau beieinander
// und gibt seinen Disposer zurück (siehe die Disposer-Liste im Mount-Effect).
import { registerE2EHooks } from '../terminal/e2e-hooks';
import { attachLinkHandling } from '../terminal/links';
import { attachClipboardShortcuts } from '../terminal/clipboard';
import { attachFileDrop } from '../terminal/file-drop';
import { attachClickToMove } from '../terminal/click-to-move';
import { PSREADLINE_HEAL_SEQUENCE } from '../../shared/psreadline-heal';
import {
  STUCK_MODE_RESET,
  sanitizeRestoredScrollback,
  parkRestoredHistory
} from '../../shared/terminal-reset';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { RemotePaneBar } from './RemotePaneBar';
import { describeIpcError } from '../ipc-error';
import { parseRemotePaneKey, remoteScopeFromKey } from '../../shared/remote-pane-key';
import { isPaneWritable } from '../store';
import type { SpawnTarget } from '../../shared/types';
import { TERMINAL_FONT_SIZE_DEFAULT } from '../../shared/types';
import { createResizeScheduler } from '../resize-scheduler';
import { createSaveScheduler, type SaveScheduler } from '../save-scheduler';
import {
  createPaneAutoTitleTracker, DMWS_PROMPT_OSC, isPromptPayload
} from '../../shared/pane-auto-title';

interface Props { paneId: string; cwd: string; active?: boolean; }

// Scrollback kept in the live xterm buffer AND exported by the serializer (the
// two must match: serializing more than the buffer holds is pointless, less
// would silently drop restorable history). Also caps scrollback.json growth.
const SCROLLBACK_LINES = 1000;

// Remove the legacy in-buffer notice; new notices live in the translated UI.
const RESTORE_MARKER_TEXT = 'vorherige Sitzung wiederhergestellt (Prozess neu gestartet)';


// The translucent terminal background as an rgba() string (opacity baked into the
// alpha so a translucent terminal reveals the window vibrancy). This is painted as
// a CSS backdrop *behind* the canvas — see bgColor's use in syncBackgrounds. The
// background can be overridden (customBg).
function bgColor(themeId: string, opacity: number, customBg?: string): string {
  const t = getTheme(themeId);
  const a = Math.min(1, Math.max(0, opacity));
  const bgHex = customBg ?? t.background;
  const m = /^#?([0-9a-f]{6})$/i.exec(bgHex.trim());
  if (!m) return bgHex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Build an xterm ITheme from a theme id + opacity. The background is the themed
// colour with opacity baked into the alpha (so a translucent terminal reveals the
// window vibrancy). The WebGL renderer paints this; keeping it opaque (alpha-baked,
// not fully transparent) is required — a fully transparent canvas makes the WebGL
// renderer draw written cells with an opaque-black background (visible boxes).
function buildTheme(themeId: string, opacity: number, customBg?: string): ITheme {
  const t = getTheme(themeId);
  const [
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite
  ] = t.ansi;
  return {
    background: bgColor(themeId, opacity, customBg), foreground: t.foreground, cursor: t.cursor,
    // Thin, macOS-like overlay scrollbar slider (xterm v6 fades it when idle).
    scrollbarSliderBackground: 'rgba(190, 190, 190, 0.4)',
    scrollbarSliderHoverBackground: 'rgba(190, 190, 190, 0.55)',
    scrollbarSliderActiveBackground: 'rgba(190, 190, 190, 0.7)',
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite
  };
}

// FitAddon rounds the terminal to a whole number of rows, so the host is usually
// a little taller than rows×cellHeight. The WebGL renderer paints that leftover
// slack as opaque black (an opaque compositing layer the DOM background can't show
// through), which is the black bar seen at the bottom of every pane. We fix it by
// pinning the host to an exact multiple of the cell height after each fit, so the
// WebGL region has no uncovered slack; the few remaining pixels live in the host
// wrapper below it (plain CSS, no WebGL) which we paint with the themed background
// so they blend in. We also set the viewport background for the DOM-renderer
// fallback path, which xterm normally themes itself but only for that renderer.
function syncBackgrounds(host: HTMLElement | null, background: string | undefined): void {
  if (!host || !background) return;
  const vp = host.querySelector('.xterm-viewport') as HTMLElement | null;
  if (vp) vp.style.backgroundColor = background;
  // The wrapper holds the sub-cell slack strip below the pinned host.
  if (host.parentElement) host.parentElement.style.backgroundColor = background;
}

export function TerminalView({ paneId, cwd, active = true }: Props): React.JSX.Element {
  const { t } = useTranslation();
  // Remote-Pane? Der namespaced Schlüssel trägt Server/Projekt/Server-Pane in
  // sich (shared/remote-pane-key.ts); für die Lebenszeit der Pane konstant.
  const remoteRef = parseRemotePaneKey(paneId);
  // Der Mount-Effect läuft bewusst nur einmal pro Pane, schreibt aber eine
  // übersetzte Meldung (Prozess beendet). Nähme er `t` in die Deps, würde ein
  // Sprachwechsel zur Laufzeit das Terminal disposen und die Shell neu starten —
  // ungleich schlimmer als der Fehler, den es behebt. Über die Ref liest er
  // stattdessen immer die aktuelle Übersetzungsfunktion.
  const tRef = useRef(t);
  tRef.current = t;
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // The pane holds a WebGL/GPU context only while its workspace is active. Electron
  // caps live WebGL contexts (~16); one per mounted-but-hidden pane would exhaust
  // them and force xterm to drop the oldest context. syncWebgl disposes the addon
  // when the workspace goes inactive and recreates it on return. The xterm buffer
  // stays in memory either way, so no output is lost and the DOM renderer (xterm's
  // fallback, same path used on context loss) covers the hidden pane.
  const webglRef = useRef<WebglAddon | null>(null);
  const webglFailedRef = useRef(false); // creation threw (no GL at all) — stop retrying
  // Pending re-acquire timer after a context loss, plus a short-window loss counter
  // so a genuinely dead GPU can't spin re-creating contexts forever (see onContextLoss).
  const webglRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webglLossRef = useRef({ count: 0, last: 0 });
  const activeRef = useRef(active);
  // The mount effect owns the scheduler; the active effect steers its cadence.
  const saveSchedulerRef = useRef<SaveScheduler | null>(null);
  const fontSize = useStore((s) => s.settings.terminalFontSize ?? TERMINAL_FONT_SIZE_DEFAULT);
  const themeId = useStore((s) => s.settings.themeId);
  const opacity = useStore((s) => s.settings.terminalOpacity);
  const customBg = useStore((s) => s.settings.terminalBackground);
  const setPaneStatus = useStore((s) => s.setPaneStatus);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const requestClosePane = useStore((s) => s.requestClosePane);
  const [atBottom, setAtBottom] = useState(true);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [exited, setExited] = useState<number | null>(null);
  const [historyRestored, setHistoryRestored] = useState(false);
  const retryStartRef = useRef<(() => void) | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Acquire or release the WebGL renderer to match whether this pane should hold a
  // GPU context (see webglRef comment). Idempotent: re-acquiring an existing
  // context, or releasing a missing one, is a no-op. Called from the mount effect
  // (initial state) and from the active effect (on workspace switch).
  const syncWebgl = useCallback((shouldHave: boolean): void => {
    const term = termRef.current;
    if (!term || window.api.disableWebgl || webglFailedRef.current) return;
    if (shouldHave && !webglRef.current) {
      try {
        const addon = new WebglAddon();
        // Context loss (GPU sleep/reset/switch) frees the context: drop the addon so
        // xterm falls back to the DOM renderer — then re-acquire WebGL automatically
        // after a short settle delay, so the pane doesn't stay stuck on the slow DOM
        // renderer (sluggish scroll + different scrollbar) until the next workspace
        // switch or restart. Bounded: if losses keep recurring back-to-back the GPU
        // is genuinely gone, so we stop retrying and stay on the DOM renderer.
        addon.onContextLoss(() => {
          addon.dispose();
          if (webglRef.current === addon) webglRef.current = null;
          const now = Date.now();
          const loss = webglLossRef.current;
          loss.count = now - loss.last < 10_000 ? loss.count + 1 : 1;
          loss.last = now;
          if (loss.count > 5) return; // repeated immediate losses → give up
          if (webglRetryRef.current) clearTimeout(webglRetryRef.current);
          webglRetryRef.current = setTimeout(() => {
            webglRetryRef.current = null;
            if (activeRef.current) syncWebgl(true);
          }, 1000);
        });
        term.loadAddon(addon);
        webglRef.current = addon;
      } catch {
        webglRef.current?.dispose();
        webglRef.current = null;
        webglFailedRef.current = true; // no GL context available at all — don't retry
      }
    } else if (!shouldHave && webglRef.current) {
      webglRef.current.dispose();
      webglRef.current = null;
    }
  }, []);

  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;
    let historyLoaded = false;
    let processEnded = false;
    // Im Effect neu abgeleitet (statt remoteRef aus dem Render zu schließen):
    // der Effect hängt bewusst nur an paneId, und der Schlüssel bestimmt das
    // Ziel vollständig.
    const remote = parseRemotePaneKey(paneId);
    const term = new Terminal({
      fontFamily: 'Menlo, "Cascadia Mono", monospace',
      fontSize: useStore.getState().settings.terminalFontSize ?? TERMINAL_FONT_SIZE_DEFAULT,
      allowTransparency: true,
      theme: buildTheme(
        useStore.getState().settings.themeId,
        useStore.getState().settings.terminalOpacity,
        useStore.getState().settings.terminalBackground
      ),
      cursorBlink: true,
      scrollback: SCROLLBACK_LINES,
      // xterm's native alt-click only ever emits ←/→ and models the prompt as
      // one wrapped logical line, so it can't reach another line of a multi-line
      // editor. Disable it; the custom mouseup handler below handles ↑/↓ too.
      altClickMovesCursor: false
    });
    termRef.current = term;
    // Jeder attach*/register* unten gibt seinen eigenen Disposer zurück und legt
    // ihn hier ab; das Cleanup ruft die Liste rückwärts auf. Vorher stand jeder
    // Teardown-Schritt einzeln am Ende des Effects, teils 400 Zeilen von seinem
    // Setup entfernt — genau so gingen zwei der drei e2e-Hooks verloren.
    const disposers: Array<() => void> = [];

    disposers.push(registerE2EHooks(paneId, term));

    const fit = new FitAddon();
    term.loadAddon(fit);
    const search = new SearchAddon();
    term.loadAddon(search);
    registerSearch(paneId, search);
    const serializeAddon = new SerializeAddon();
    term.loadAddon(serializeAddon);
    term.open(host);

    const autoTitleTracker = createPaneAutoTitleTracker({
      onTitle: (title) => useStore.getState().setPaneAutoTitle(paneId, title)
    });
    registerTerminalInputTracking(paneId, (data) => autoTitleTracker.onInput(data));

    // GPU renderer. xterm's default DOM renderer chokes on high-throughput
    // streaming output (e.g. an active Claude Code session) and on scrolling
    // through a large buffer, which shows up as visible lag. WebGL fixes that.
    // Only acquired while the workspace is active (see syncWebgl); failures fall
    // back to the DOM renderer rather than crash.
    syncWebgl(activeRef.current);

    // Clicking a link opens the right-hand preview panel instead of the OS browser.
    disposers.push(attachLinkHandling(term, { paneId, spawnCwd: cwd }));

    // Track whether the viewport is scrolled to the bottom (controls the
    // floating scroll-to-bottom button). baseY is the topmost scrollback row;
    // viewportY === baseY means we are at the bottom.
    const updateAtBottom = (): void => {
      const b = term.buffer.active;
      setAtBottom(b.viewportY >= b.baseY);
    };
    const scrollDisp = term.onScroll(updateAtBottom);

    // Shift+wheel always scrolls the viewport — even while a program has mouse
    // tracking enabled, where xterm otherwise reports wheel events to the
    // program instead of scrolling. A guaranteed manual escape from a hijacked
    // wheel (matching iTerm2/GNOME Terminal); plain wheel behavior is unchanged.
    // Ctrl+wheel stays reserved for UI zoom, Alt/Meta for programs.
    term.attachCustomWheelEventHandler((e) => {
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.deltaY === 0) return true;
      const lines = Math.max(1, Math.round(Math.abs(e.deltaY) / 40));
      term.scrollLines(e.deltaY < 0 ? -lines : lines);
      return false;
    });

    // Live cwd reporting from the shell: OSC 9;9 (PowerShell) or OSC 7 (POSIX).
    // Update the pane title via the store; return true to mark the OSC handled.
    const reportCwd = (path: string | null): boolean => {
      if (path) useStore.getState().setPaneCwd(paneId, path);
      return true;
    };
    term.parser.registerOscHandler(9, (data) => reportCwd(parseOsc9(data)));
    term.parser.registerOscHandler(7, (data) => reportCwd(parseOsc7(data)));
    // Heilung der PSReadLine-Eingabespalte nach einer Verbreiterung.
    //
    // PSReadLine 2.0.0 rechnet bei jeder Konsolengrößenänderung
    // `_initialX %= BufferWidth`. War das PTY dabei schmaler als der Prompt
    // lang ist, bleibt die Spalte dauerhaft falsch und jede Eingabe wird
    // mitten in den Prompt gezeichnet. Nur `InvokePrompt()` repariert das; der
    // Bootstrap legt es auf F24, wir drücken die Taste danach für den Nutzer
    // (siehe src/shared/psreadline-heal.ts und den Plan im docs-Ordner).
    //
    // Drei Bedingungen, alle notwendig:
    //  * win32 und lokal — die Bytes sind win32-input-mode. Conhost verwirft
    //    ein unbekanntes CSI still, eine POSIX-Pty hat aber gar keinen Parser
    //    dafür und würde sie als getippt in die Kommandozeile schreiben.
    //  * Die Pane hat den privaten Prompt-Marker mit unserem Nonce gezeigt.
    //    Auf win32 bekommt nur powershell/pwsh den Bootstrap (siehe
    //    shellArgs) — der Marker IST also der Beleg, dass hier eine
    //    PowerShell mit gebundenem F24 sitzt.
    //  * Seit diesem Marker wurde keine Zeile abgeschickt. Nur dann kann ein
    //    Programm laufen, das die Bytes statt PSReadLine abbekäme.
    const healEnabled = !remote && window.api.platform === 'win32';
    // Die Heilung muss dem Resize folgen, nicht ihm vorauslaufen: InvokePrompt
    // liest Console.CursorLeft, und vor dem Reflow steht der noch auf der
    // umgebrochenen Position. Umgekehrt darf die Verzögerung nicht in die Nähe
    // menschlicher Reaktionszeit kommen — wer nach dem Ziehen sofort tippt,
    // soll nicht doch in den kaputten Prompt schreiben. Beides zusammen ist
    // eine kurze Frist: das Resize geht als IPC raus und wird im Main synchron
    // an ResizePseudoConsole durchgereicht, die Tastenbytes nehmen danach
    // denselben Weg.
    const HEAL_DELAY_MS = 30;
    let promptArmed = false;
    let healTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleHeal = (): void => {
      if (!healEnabled) return;
      if (healTimer !== null) clearTimeout(healTimer);
      healTimer = setTimeout(() => {
        healTimer = null;
        if (!promptArmed) return;
        // Bewusst ohne autoTitleTracker/activity: das sind synthetische Bytes,
        // kein Nutzer-Input. Der Marker, den InvokePrompt danach erneut
        // ausgibt, trifft eine Pane am leeren Prompt — der Titel ist dort
        // ohnehin schon leer, das Re-Arming ist also folgenlos.
        window.api.input({ paneId, data: PSREADLINE_HEAL_SEQUENCE });
      }, HEAL_DELAY_MS);
    };

    // A private marker emitted only by DM Workspace's LOCAL shell hook. Unlike
    // OSC 7, it is not forwarded by a remote SSH shell, so it safely tells the
    // title tracker when a command ended and the local prompt is ready again.
    term.parser.registerOscHandler(DMWS_PROMPT_OSC, (data) => {
      // Only a marker carrying this launch's nonce counts: the sequence is
      // plain bytes in the output stream, so without that check any program —
      // or the remote end of an ssh session — could print it and re-arm title
      // capture for the next line the user types (a sudo password).
      if (isPromptPayload(data, window.api.promptNonce)) {
        autoTitleTracker.onShellPrompt();
        window.api.agentShellReturned(paneId);
        // Ab hier steht ein leerer lokaler Prompt — der einzige Zustand, in dem
        // die Heilung gefahrlos gesendet werden darf.
        promptArmed = true;
        // Zusätzlich melden, damit die Navigation es sehen kann. promptArmed
        // bleibt lokal, weil die Heilung es synchron braucht; hier wird nur
        // gemeldet, nicht abgeleitet — was der Zustand bedeutet, entscheidet
        // shared/pane-busy.ts.
        useStore.getState().setPaneShell(paneId, 'atPrompt');
        // The local prompt is on screen, so no full-screen program owns the
        // terminal: an alt screen or mouse tracking still active here is stale —
        // left behind by a TUI that crashed or was killed (e.g. by an app
        // update mid-session) — and hijacks the wheel so the pane can't scroll.
        // Clear it automatically instead of waiting for a manual context-menu
        // "Reset terminal". Multiplexers (tmux, screen, zellij) swallow this
        // private OSC from inner shells, so it never fires while they hold the
        // terminal with mouse tracking legitimately on.
        if (term.buffer.active.type === 'alternate' || term.modes.mouseTrackingMode !== 'none') {
          term.write(STUCK_MODE_RESET);
        }
      }
      return true;
    });

    // Per-pane activity machine: drive status from the raw output/input streams.
    const activity = createPaneActivity({
      onChange: (status) => setPaneStatus(paneId, status),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
    });
    disposers.push(attachClipboardShortcuts(host, term, {
      paneId,
      onInput: () => activity.onInput()
    }));

    disposers.push(attachFileDrop(host, term, {
      onInput: () => activity.onInput()
    }));

    disposers.push(attachClickToMove(host, term, {
      paneId,
      plainClickEnabled: () => useStore.getState().settings.clickMovesCursor ?? false,
      onInput: () => activity.onInput()
    }));

    const safeFit = (): boolean => {
      // Clear any previous pin so we measure (and fit to) the full wrapper height,
      // then pin the host to the exact rendered rows height. fit.fit() makes xterm
      // set .xterm-screen's height to rows×cellHeight synchronously, so reading it
      // back is reliable even before the first WebGL render. Pinning leaves the
      // WebGL region with no uncovered slack to paint black (see syncBackgrounds).
      host.style.height = '';
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return false;
      fit.fit();
      const screen = host.querySelector('.xterm-screen') as HTMLElement | null;
      if (screen && screen.offsetHeight > 0) host.style.height = `${screen.offsetHeight}px`;
      return true;
    };

    // Persist the *rendered* terminal buffer (text + colors) rather than the raw
    // PTY byte stream, so a restart replays clean, reflowable history instead of
    // control-character garbage. excludeModes/excludeAltBuffer are essential:
    // without them serialize() appends the live DECSET modes (mouse tracking,
    // bracketed paste, focus reporting) and any active alternate-screen frame,
    // and replaying those on restart poisons the fresh pane — stuck in the alt
    // screen with a hijacked wheel, the "restored session can't scroll" bug.
    // Live gelesen statt über eine Effect-Dependency: der Mount-Effect hängt an
    // [paneId], eine zusätzliche Dependency würde bei jedem Umschalten das
    // Terminal neu aufbauen und den laufenden Prozess killen. Gleiches Muster
    // wie plainClickEnabled weiter oben.
    // Remote-Panes speichern keinen lokalen Verlauf: ihr Scrollback kommt beim
    // (Re-)Subscribe vom Server (Seq-Resume) — eine lokale Kopie würde beim
    // nächsten Start doppelt replayed.
    const historyEnabled = (): boolean =>
      !remote && useStore.getState().settings.restoreTerminalHistory !== false;

    const doSave = (): void => {
      // Vor dem serialize(): der Aufruf läuft den kompletten Puffer ab, und das
      // Ergebnis würde im Main-Prozess ohnehin verworfen.
      if (!historyEnabled() || !historyLoaded) return;
      const data = serializeAddon.serialize({
        scrollback: SCROLLBACK_LINES,
        excludeModes: true,
        excludeAltBuffer: true
      });
      // Never persist the restore separator — serialize captures the rendered
      // buffer, so without this each restart's separator would be saved and they
      // would accumulate across restarts.
      const cleaned = data.split('\n').filter((line) => !line.includes(RESTORE_MARKER_TEXT)).join('\n');
      window.api.saveScrollback(paneId, cleaned);
    };
    // Serialize walks the whole buffer on the renderer thread, so hidden panes
    // save on a slow cadence (plus once when their workspace is switched away)
    // instead of every second — see save-scheduler.ts.
    const saveScheduler = createSaveScheduler({ save: doSave });
    saveScheduler.setActive(activeRef.current);
    saveSchedulerRef.current = saveScheduler;
    const flushSave = (): void => saveScheduler.flush();

    // Wipe the buffer (scrollback + viewport), keeping the current prompt line as
    // the new first line, then persist immediately so a restart doesn't replay
    // the history we just cleared. Driven from the context menu via the registry.
    const clearBuffer = (): void => {
      term.clear();
      flushSave();
    };
    registerTerminal(paneId, clearBuffer);
    registerTerminalFocus(paneId, () => term.focus());

    // Attach listeners BEFORE spawning so the shell's first prompt is never missed.
    const offData = window.api.onData(paneId, (data) => {
      term.write(data, updateAtBottom);
      saveScheduler.schedule();
      activity.onOutput();
    });
    const offExit = window.api.onExit(paneId, (exitCode) => {
      processEnded = true;
      // Remote session lifecycle remains server-owned; a later server restart
      // must not leave its reattached terminal with input disabled locally.
      if (!remote) {
        setExited(exitCode);
        term.options.disableStdin = true;
      }
      activity.reset();
      useStore.getState().setPaneAutoTitle(paneId, '');
      // Eine tote Pane arbeitet nicht mehr. Ohne das bliebe der zuletzt
      // gemeldete Zustand stehen — bei einem Prozess, der mitten in einem
      // Kommando stirbt, also 'running', und der Indikator hinge für immer.
      // 'unknown' statt 'atPrompt': es gibt keinen Prompt mehr, der Rückfall
      // auf die Heuristik ist hier die ehrlichere Aussage.
      useStore.getState().setPaneShell(paneId, 'unknown');
      // tRef statt t: die Meldung erscheint in der Sprache, die beim Beenden des
      // Prozesses eingestellt ist — nicht in der, die beim Mount der Pane galt.
      term.write(`\r\n[${tRef.current('terminal.processExited', { code: exitCode })}]\r\n`);
    });
    const inputDisp = term.onData((data) => {
      // Driver-Gating: Ohne Schreibrecht wird Input einer Remote-Pane lokal
      // verworfen (der Server lehnt ihn ohnehin ab) — so tippt niemand
      // "ins Leere" mit sichtbarer Verzögerung bis zur Server-Ablehnung.
      if (remote && !isPaneWritable(useStore.getState(), paneId)) return;
      // Erst das Absenden einer Zeile kann ein Programm starten, das die Bytes
      // der Heilung abbekäme. Eine angefangene Eingabe ist harmlos: dort liegt
      // PSReadLine noch selbst am Ruder und zeichnet sie nach InvokePrompt an
      // der korrigierten Spalte neu — genau der Fall, für den die Heilung da
      // ist. Bis zum nächsten Prompt-Marker bleibt sie danach aus.
      if (/[\r\n]/.test(data)) {
        promptArmed = false;
        // 'running' heißt nur: seit dem letzten Prompt wurde eine Zeile
        // abgeschickt. NICHT: hier arbeitet gerade etwas. Der Unterschied ist
        // gemessen, an echten Claude- und Codex-Sitzungen: startet die Zeile ein
        // interaktives Unterprogramm — Agent, ssh, REPL, tmux —, druckt das
        // seinen eigenen Prompt, aber nie unseren Marker (Multiplexer schlucken
        // den privaten OSC zusätzlich, siehe den Handler oben). Der Zustand
        // bleibt dann bis zum Ende dieses Programms stehen, obwohl der Agent
        // längst auf Eingabe wartet.
        //
        // Deshalb wertet pane-busy.ts nur 'atPrompt' als Auskunft und lässt
        // sonst die Ausgabe entscheiden. Wer diesen Melder liest, darf ihn also
        // nicht als „läuft" verstehen — er ist die Gegenprobe zu 'atPrompt'.
        useStore.getState().setPaneShell(paneId, 'running');
      }
      autoTitleTracker.onInput(data);
      window.api.input({ paneId, data });
      activity.onInput();
    });

    // Replay any saved scrollback once, before the fresh shell starts writing, so
    // restored history appears above the new prompt rather than interleaved with it.
    let restorePromise: Promise<void> | null = null;
    const restoreOnce = (): Promise<void> => {
      if (!restorePromise) {
        // Main liefert bei ausgeschalteter Option ohnehin null; die Prüfung spart
        // den IPC-Round-Trip und verhindert den Restore-Separator im leeren Pane.
        if (!historyEnabled()) {
          historyLoaded = true;
          restorePromise = Promise.resolve();
          return restorePromise;
        }
        restorePromise = window.api.getScrollback(paneId).then((saved) => {
          if (disposed) return;
          historyLoaded = true;
          if (saved) {
            // Sanitize first: saves from versions ≤ 0.9.30 embed the terminal
            // modes and alt-screen frame active at save time, which would put
            // the fresh pane straight back into the stuck state they came from.
            term.write(sanitizeRestoredScrollback(saved).split('\n')
              .filter((line) => !line.includes(RESTORE_MARKER_TEXT)).join('\n'));
            setHistoryRestored(true);
            // Hand the shell an empty viewport. Everything above is now in the
            // scrollback, out of reach of the full repaints the shell performs
            // at its first prompt and on every resize — those address the
            // viewport absolutely and would otherwise paint over this history.
            term.write(parkRestoredHistory(term.rows));
          }
        }).catch((error: unknown) => {
          restorePromise = null; // A transient read failure can be retried.
          throw error;
        });
      }
      return restorePromise;
    };

    let spawned = false;
    let spawnSent = false; // true once the spawn IPC has actually gone out
    // Zuletzt an das PTY gemeldete Geometrie — der Spawn zählt als erste
    // Meldung. Ohne das schickt der Scheduler nach jedem Fit ein pty:resize,
    // auch wenn sich cols/rows gar nicht geändert haben.
    let sentCols = 0;
    let sentRows = 0;
    const spawnNow = (): void => {
      if (spawned || disposed) return;
      spawned = true;
      setStarting(true);
      setExited(null);
      processEnded = false;
      // Unmittelbar vor dem Spawn noch einmal fitten: zwischen dem letzten Fit
      // und dem Ablauf des Breiten-Debounce (siehe spawnOnce) kann sich die
      // Pane bewegt haben, und die Spawn-Dimensionen sind genau die, mit denen
      // die Shell ihren ersten Prompt zeichnet.
      safeFit();
      void restoreOnce().then(async () => {
        if (disposed) return;
        // Remote-Panes spawnen mit target: der BackendRouter reicht sie an das
        // RemotePtyBackend weiter (Subscribe statt lokalem PTY). Der scopeKey
        // aus dem Pane-Schlüssel bestimmt Projekt- vs. User-Scope.
        const target: SpawnTarget | undefined = remote
          ? {
              kind: 'remote',
              serverId: remote.serverId,
              scope: remoteScopeFromKey(remote.scopeKey),
              remotePaneId: remote.remotePaneId
            }
          : undefined;
        // Ein fehlgeschlagener Spawn hinterlässt eine tote Pane — sichtbar machen
        // statt als stillen Rejection verpuffen zu lassen.
        const cols = term.cols || 80;
        const rows = term.rows || 24;
        await window.api.spawn({ paneId, cwd, cols, rows, ...(target ? { target } : {}) });
        if (disposed || processEnded) return;
        setStartError(null);
        term.options.disableStdin = false;
        sentCols = cols;
        sentRows = rows;
        spawnSent = true;
        // One-shot startup command for a pane created from a template. Consuming
        // clears it (and persists) so it never runs again after a restart. The
        // PTY buffers the input until the shell is ready to read it.
        const command = useStore.getState().consumeStartupCommand(paneId);
        if (command) {
          const data = `${command}\r`;
          autoTitleTracker.onInput(data);
          window.api.input({ paneId, data });
          activity.onInput();
        }
      }).catch((error: unknown) => {
        if (!disposed) setStartError(describeIpcError(error));
      }).finally(() => {
        retrying = false;
        if (!disposed) setStarting(false);
      });
    };
    let retrying = false;
    retryStartRef.current = () => {
      if (retrying || disposed) return;
      retrying = true;
      spawned = false;
      spawnNow();
    };

    // Spawnen erst, wenn die Panebreite stabil ist.
    //
    // Die Shell zeichnet ihren ersten Prompt sofort nach dem Spawn. Ändert sich
    // die Spaltenzahl danach noch einmal, rechnet PowerShells PSReadLine 2.0.0
    // `_initialX = _initialX % BufferWidth` — war das PTY dabei schmaler als
    // der Prompt lang ist, landet jede Eingabe fortan mitten im Prompt
    // (docs/superpowers/plans/2026-08-22-psreadline-initialx-fix.md). Zwei
    // Frames wie bisher reichen dafür nicht: WebGL-Messung, Host-Pinning und
    // ein Workspace-Wechsel verschieben die Breite noch danach.
    //
    // Panes ohne messbare Breite (verstecktes Workspace, clientWidth === 0)
    // spawnen unverändert sofort mit dem 80x24-Fallback — dort gäbe es sonst
    // nie einen Prozess. Die Deckelung verhindert, dass eine Pane, deren Breite
    // sich dauernd ändert (laufender Splitter-Drag), gar nicht mehr startet.
    const SPAWN_SETTLE_MS = 100;
    const SPAWN_SETTLE_MAX = 10;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let settleWidth = -1;
    let settleTries = 0;
    const paneWidth = (): number => (host.parentElement ?? host).clientWidth;
    const spawnOnce = (): void => {
      if (spawned) return;
      const width = paneWidth();
      if (width <= 0) { spawnNow(); return; }
      if (settleTimer !== null) {
        if (width === settleWidth) return; // schon armiert, Breite unverändert
        clearTimeout(settleTimer);
      }
      settleWidth = width;
      settleTimer = setTimeout(() => {
        settleTimer = null;
        // Breite hat sich seit dem Armieren wieder bewegt: neu abwarten, bis
        // das Budget aufgebraucht ist.
        if (paneWidth() !== settleWidth && settleTries++ < SPAWN_SETTLE_MAX) {
          spawnOnce();
          return;
        }
        spawnNow();
      }, SPAWN_SETTLE_MS);
    };

    // Fit + spawn after the flex layout has settled so the PTY starts at the
    // real terminal size and the first prompt renders correctly.
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        safeFit();
        spawnOnce();
        const s = useStore.getState().settings;
        syncBackgrounds(host, bgColor(s.themeId, s.terminalOpacity, s.terminalBackground));
      });
    });

    // Fit once per frame (the terminal keeps reflowing live while a splitter is
    // dragged), but debounce the pty:resize IPC so the shell gets one SIGWINCH
    // when the drag settles instead of a storm — see resize-scheduler.ts.
    const resizeScheduler = createResizeScheduler({
      fit: () => {
        if (!safeFit()) return false;
        spawnOnce();
        // Don't let a resize IPC race ahead of the (async) spawn IPC — the
        // spawn itself carries the freshly fitted cols/rows, so nothing is lost.
        return spawnSent;
      },
      // Unveränderte Geometrie nicht melden: jedes pty:resize löst am anderen
      // Ende ein SIGWINCH bzw. einen ConPTY-Repaint aus, und genau der bringt
      // PSReadLine dazu, seine Eingabespalte neu zu rechnen. Der Spawn zählt
      // als erste Meldung (siehe sentCols/sentRows).
      sendResize: () => {
        if (term.cols === sentCols && term.rows === sentRows) return;
        const widened = term.cols > sentCols;
        sentCols = term.cols;
        sentRows = term.rows;
        window.api.resize({ paneId, cols: term.cols, rows: term.rows });
        // Nur Verbreiterungen: beim Schmalerwerden ist die von PSReadLine neu
        // gerechnete Spalte korrekt (der Prompt bricht dort wirklich um), erst
        // das spätere Verbreitern macht sie falsch.
        if (widened) scheduleHeal();
      },
      // The wrapper's width: unlike the host it is never pinned, so it always
      // tracks the pane layout. Width changes defer the fit (see scheduler).
      getWidth: () => (host.parentElement ?? host).clientWidth
    });
    // Observe the wrapper, not the host: safeFit pins the host to a fixed pixel
    // height, so a height-only pane resize (splitter drag, maximize) never
    // changes the host's size and would never fire the observer. The wrapper
    // always tracks the pane layout and is never pinned.
    const ro = new ResizeObserver(() => resizeScheduler.onResize());
    ro.observe(host.parentElement ?? host);

    registerTerminalLayoutRefresh(paneId, () => {
      resizeScheduler.flush();
      // fit() updates the geometry synchronously. Invalidate the viewport too,
      // so an idle normal-buffer app cannot retain torn rows from the old width.
      if (term.rows > 0) term.refresh(0, term.rows - 1);
    });

    // The very first fit can run before the WebGL renderer has measured the cell
    // size, so .xterm-screen still has no height and the host can't be pinned —
    // which leaves the black bottom bar on idle panes (no output → no resize/render
    // to retry). Poll across a few frames until the screen reports a real height,
    // then pin once. Cancelled on unmount.
    let pinRaf = 0;
    let pinTries = 0;
    const pinWhenReady = (): void => {
      const screen = host.querySelector('.xterm-screen') as HTMLElement | null;
      if (screen && screen.offsetHeight > 0) {
        host.style.height = `${screen.offsetHeight}px`;
        return;
      }
      if (pinTries++ < 60) pinRaf = requestAnimationFrame(pinWhenReady);
    };
    pinWhenReady();

    return () => {
      disposed = true;
      retryStartRef.current = null;
      flushSave();
      saveSchedulerRef.current = null;
      saveScheduler.dispose();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null; }
      if (healTimer !== null) { clearTimeout(healTimer); healTimer = null; }
      ro.disconnect();
      resizeScheduler.dispose();
      unregisterTerminalLayoutRefresh(paneId);
      unregisterTerminalInputTracking(paneId);
      autoTitleTracker.dispose();
      cancelAnimationFrame(pinRaf);
      // Rückwärts, damit die Reihenfolge das Spiegelbild des Aufbaus ist.
      for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
      offData();
      offExit();
      inputDisp.dispose();
      scrollDisp.dispose();
      activity.dispose();
      unregisterSearch(paneId);
      unregisterTerminal(paneId);
      unregisterTerminalFocus(paneId);
      if (webglRetryRef.current) { clearTimeout(webglRetryRef.current); webglRetryRef.current = null; }
      webglRef.current?.dispose();
      webglRef.current = null;
      term.dispose();
      termRef.current = null;
    };
    // paneId is stable for the component's lifetime; cwd only matters at spawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  useEffect(() => {
    const term = termRef.current;
    if (term && term.options.fontSize !== fontSize) {
      term.options.fontSize = fontSize;
      refreshTerminalLayoutAfterCommit(paneId);
    }
  }, [fontSize, paneId]);

  // Apply theme changes live (theme / opacity / background override) without
  // recreating the terminal.
  useEffect(() => {
    const term = termRef.current;
    if (term) {
      term.options.theme = buildTheme(themeId, opacity, customBg);
      syncBackgrounds(hostRef.current, bgColor(themeId, opacity, customBg));
    }
  }, [themeId, opacity, customBg]);

  // Acquire/release the GPU context as this pane's workspace becomes active or
  // inactive. The xterm buffer is untouched, so switching back is still instant —
  // only the WebGL renderer is re-attached. On re-activation force one repaint so
  // the fresh renderer paints the existing buffer right away rather than waiting
  // for the next output or resize.
  useEffect(() => {
    const wasActive = activeRef.current;
    activeRef.current = active;
    syncWebgl(active);
    // Hidden panes serialize their scrollback on a slow cadence; going hidden
    // flushes a pending save so the last-seen state is what a crash restores.
    saveSchedulerRef.current?.setActive(active);
    if (active && !wasActive) {
      const term = termRef.current;
      if (term) term.refresh(0, Math.max(0, term.rows - 1));
    }
  }, [active, syncWebgl]);

  const scrollToBottom = (): void => { termRef.current?.scrollToBottom(); };

  const menuItems = (): MenuItem[] => {
    const term = termRef.current;
    const hasSelection = !!term?.hasSelection();
    return [
      {
        label: t('menu.copy'),
        disabled: !hasSelection,
        // Refocus the terminal: clicking a menu button moves focus onto the
        // button, and on close it falls to <body>, not back to xterm's hidden
        // textarea — so keystrokes (e.g. Enter after Paste) are dropped until
        // the user clicks into the terminal. term.focus() restores it.
        // Trailing padding is layout (TUIs paint boxes with real space cells),
        // so the default copy strips it; leading indentation stays (code).
        onClick: () => { const sel = term?.getSelection(); if (sel) window.api.clipboardWrite(stripTrailingWhitespace(sel)); term?.focus(); }
      },
      {
        // Multi-line command displayed by a TUI → one pasteable line: fully
        // trimmed, blank lines dropped, fragments joined with single spaces.
        label: t('menu.copyAsCommand'),
        disabled: !hasSelection,
        onClick: () => {
          const sel = term?.getSelection();
          const cmd = sel ? selectionAsCommand(sel) : '';
          if (cmd) window.api.clipboardWrite(cmd);
          term?.focus();
        }
      },
      {
        label: t('menu.paste'),
        // Kein async-Handler: MenuItem.onClick erwartet void, ein zurückgegebenes
        // Promise würde niemand auswerten — ein Fehler beim Clipboard-Lesen wäre
        // ein stiller Rejection.
        onClick: () => {
          void window.api.clipboardRead().then((text) => {
            if (text) term?.paste(text);
            term?.focus();
          });
        }
      },
      { label: t('menu.selectAll'), onClick: () => { term?.selectAll(); term?.focus(); } },
      { label: '-' },
      { label: t('menu.clearWindow'), onClick: () => { clearTerminal(paneId); term?.focus(); } },
      { label: t('menu.clearAllWindows'), onClick: () => { term?.focus(); setConfirmClearAll(true); } },
      // Unstick the terminal's input/mouse modes without wiping its contents — e.g.
      // after a TUI crashed and left mouse tracking on, hijacking the wheel.
      { label: t('menu.resetTerminal'), onClick: () => { term?.write(STUCK_MODE_RESET); term?.focus(); } },
      { label: '-' },
      { label: t('menu.search'), onClick: () => setSearchOpen(paneId) },
      // Auch für Remote-Panes: requestClosePane entscheidet im Store zwischen
      // lokalem Layout und pane.close und stellt in beiden Fällen die Rückfrage.
      { label: t('menu.closeTerminal'), onClick: () => { term?.focus(); requestClosePane(paneId); } }
    ];
  };

  const hostWrap = (
    <div
      className="xterm-host-wrap"
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
    >
      <div className="xterm-host" ref={hostRef} />
      {/* Drop-zone overlay: shown (via the `.drop-target` class the drag handlers
          toggle on .xterm-host) while a file is dragged over the terminal. It
          blurs the terminal behind it and shows a full-area hint. pointer-events
          stay off so the underlying host keeps receiving the drag/drop events. */}
      <div className="drop-overlay" aria-hidden>
        <div className="drop-overlay-inner">
          <svg className="drop-overlay-icon" width="40" height="40" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="1.5"
               strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <div className="drop-overlay-text">{t('terminal.dropFiles')}</div>
          <div className="drop-overlay-sub">{t('terminal.dropFilesSub')}</div>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
      {confirmClearAll && (
        <ConfirmDialog
          title={t('terminal.clearAllTitle')}
          message={t('terminal.clearAllMessage')}
          confirmLabel={t('terminal.clearAllConfirm')}
          tone="danger"
          onConfirm={() => {
            const ws = useStore.getState().activeWorkspace();
            clearTerminals(collectPaneIds(ws?.layout ?? null));
            setConfirmClearAll(false);
          }}
          onCancel={() => setConfirmClearAll(false)}
        />
      )}
      {!atBottom && (
        <button className="scroll-bottom-btn" title={t('terminal.scrollToBottom')} onClick={scrollToBottom}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6l4 4 4-4" />
            <path d="M4 11h8" />
          </svg>
        </button>
      )}
    </div>
  );

  return (
    <div className="terminal-pane-stack">
      {remoteRef && <RemotePaneBar paneId={paneId} />}
      {startError && (
        <div className="terminal-notice terminal-start-error" role="alert">
          <strong>{t('terminal.startFailed')}</strong>
          <span>{t(remoteRef ? 'terminal.startFailedRemoteHint' : 'terminal.startFailedHint')}</span>
          <details><summary>{t('terminal.errorDetails')}</summary><pre>{startError}</pre></details>
          <button type="button" className="cwd-btn" disabled={starting} onClick={() => retryStartRef.current?.()}>
            {t(starting ? 'terminal.starting' : 'terminal.retryStart')}
          </button>
        </div>
      )}
      {exited !== null && !startError && (
        <div className="terminal-notice" role="status">
          <span>{t('terminal.processExited', { code: exited })}</span>
          {!remoteRef && <button type="button" className="cwd-btn" disabled={starting} onClick={() => retryStartRef.current?.()}>{t('terminal.restartShell')}</button>}
        </div>
      )}
      {historyRestored && !startError && !starting && exited === null && (
        <div className="terminal-notice" role="status">
          <span>{t('terminal.historyRestored')}</span>
          <button type="button" className="cwd-btn" onClick={() => setHistoryRestored(false)}>{t('terminal.dismissNotice')}</button>
        </div>
      )}
      {hostWrap}
    </div>
  );
}
