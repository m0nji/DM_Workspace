import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { findLinks, resolveSource, fileTarget } from '../../shared/link-detect';
import { useStore } from '../store';
import { getTheme } from '../../shared/themes';
import { createPaneActivity } from '../pane-activity';
import { registerSearch, unregisterSearch } from '../search-registry';
import { registerTerminal, unregisterTerminal, clearTerminal, clearTerminals, registerTerminalFocus, unregisterTerminalFocus } from '../terminal-registry';
import { parseOsc7, parseOsc9 } from '../../shared/osc-cwd';
import { clickMoveSequence, type RowMeta } from '../../shared/click-cursor';
import { collectPaneIds } from '../../shared/layout-tree';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';

interface Props { paneId: string; cwd: string; }

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

export function TerminalView({ paneId, cwd }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const themeId = useStore((s) => s.settings.themeId);
  const opacity = useStore((s) => s.settings.terminalOpacity);
  const customBg = useStore((s) => s.settings.terminalBackground);
  const setPaneStatus = useStore((s) => s.setPaneStatus);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const closeActivePane = useStore((s) => s.closeActivePane);
  const [atBottom, setAtBottom] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({
      fontFamily: 'Menlo, "Cascadia Mono", monospace',
      fontSize: 13,
      allowTransparency: true,
      theme: buildTheme(
        useStore.getState().settings.themeId,
        useStore.getState().settings.terminalOpacity,
        useStore.getState().settings.terminalBackground
      ),
      cursorBlink: true,
      // xterm's native alt-click only ever emits ←/→ and models the prompt as
      // one wrapped logical line, so it can't reach another line of a multi-line
      // editor. Disable it; the custom mouseup handler below handles ↑/↓ too.
      altClickMovesCursor: false
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    const search = new SearchAddon();
    term.loadAddon(search);
    registerSearch(paneId, search);
    const serializeAddon = new SerializeAddon();
    term.loadAddon(serializeAddon);
    term.open(host);

    // GPU renderer. xterm's default DOM renderer chokes on high-throughput
    // streaming output (e.g. an active Claude Code session) and on scrolling
    // through a large buffer, which shows up as visible lag. WebGL fixes that.
    // It can fail (no GL context, lost context after sleep/GPU reset); in that
    // case dispose it and fall back to the DOM renderer rather than crash.
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => { webgl?.dispose(); webgl = null; });
      term.loadAddon(webgl);
    } catch {
      webgl?.dispose();
      webgl = null;
    }

    // Clicking a link opens the right-hand preview panel instead of the OS browser.
    const cwd0 = cwd; // spawn-time cwd; fallback until the shell reports a live cwd
    let latestPreviewCall = 0; // guards against an older click's async result overwriting a newer one
    const openInPreview = async (raw: string): Promise<void> => {
      const { paneCwd, workspaces } = useStore.getState();
      const liveCwd = paneCwd[paneId] ?? cwd0;
      const src = resolveSource(raw, liveCwd);
      if (!src) return;
      if (!src.rel) {
        // url or absolute path — open the provisional target directly
        useStore.getState().openPreview(src);
        return;
      }
      // relative path — verify against candidate bases in the main process
      const roots = workspaces.map((w) => w.cwd);
      const callId = ++latestPreviewCall;
      let abs: string | null = null;
      try {
        abs = await window.api.resolveLink(src.rel, liveCwd, roots);
      } catch {
        abs = null; // IPC failed → fall back to the not-found fix UI
      }
      if (callId !== latestPreviewCall) return; // a newer click superseded this one
      if (abs) {
        useStore.getState().openPreview({ ...src, target: fileTarget(src.kind, abs), resolved: true });
      } else {
        useStore.getState().openPreview({ ...src, resolved: false });
      }
    };

    // http(s) URLs.
    term.loadAddon(new WebLinksAddon((_event: MouseEvent | undefined, uri: string) => { void openInPreview(uri); }));

    // Bare *.md / *.html / *.htm paths in the output.
    term.registerLinkProvider({
      provideLinks(lineNo, callback) {
        const line = term.buffer.active.getLine(lineNo - 1);
        if (!line) { callback(undefined); return; }
        const text = line.translateToString(true);
        const matches = findLinks(text).filter((m) => !/^https?:\/\//i.test(m.text));
        if (matches.length === 0) { callback(undefined); return; }
        callback(matches.map((m) => ({
          range: {
            start: { x: m.startIndex + 1, y: lineNo },
            end: { x: m.startIndex + m.length, y: lineNo }
          },
          text: m.text,
          activate: () => { void openInPreview(m.text); }
        })));
      }
    });

    // Track whether the viewport is scrolled to the bottom (controls the
    // floating scroll-to-bottom button). baseY is the topmost scrollback row;
    // viewportY === baseY means we are at the bottom.
    const updateAtBottom = (): void => {
      const b = term.buffer.active;
      setAtBottom(b.viewportY >= b.baseY);
    };
    const scrollDisp = term.onScroll(updateAtBottom);

    // Live cwd reporting from the shell: OSC 9;9 (PowerShell) or OSC 7 (POSIX).
    // Update the pane title via the store; return true to mark the OSC handled.
    const reportCwd = (path: string | null): boolean => {
      if (path) useStore.getState().setPaneCwd(paneId, path);
      return true;
    };
    term.parser.registerOscHandler(9, (data) => reportCwd(parseOsc9(data)));
    term.parser.registerOscHandler(7, (data) => reportCwd(parseOsc7(data)));

    // Per-pane activity machine: drive status from the raw output/input streams.
    const activity = createPaneActivity({
      onChange: (status) => setPaneStatus(paneId, status),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
    });
    const handleTerminalPasteShortcut = (e: KeyboardEvent): void => {
      const isPasteKey = e.key.toLowerCase() === 'v' && (e.ctrlKey || e.metaKey) && !e.altKey;
      if (!isPasteKey) return;

      e.preventDefault();
      e.stopPropagation();

      void window.api.clipboardRead().then(async (text) => {
        if (text) {
          // Text on the clipboard (e.g. dictated text from the voice app):
          // paste it directly. Reading the OS clipboard via the main process
          // works even where the renderer's own clipboard is unavailable.
          term.paste(text);
          activity.onInput();
          return;
        }
        // No text — if an image is on the clipboard, forward Ctrl+V (0x16) to
        // the PTY so the running program (e.g. Claude Code) reads the image
        // from the OS clipboard itself. Swallowing the keystroke here (the old
        // behaviour) made image paste impossible. Only forward it when an image
        // is actually present, so an empty clipboard doesn't trigger a spurious
        // "no image in clipboard" paste.
        if (await window.api.clipboardHasImage()) {
          window.api.input({ paneId, data: '\x16' });
          activity.onInput();
        }
      });
    };
    host.addEventListener('keydown', handleTerminalPasteShortcut, true);

    // Click → walk the running program's input cursor to the clicked cell,
    // using only ←/→ (which cross line boundaries in these editors). We feed the
    // key sequence to the PTY so the program (shell, Claude Code, Codex) moves
    // its own cursor. Option/Alt+click always triggers; a plain click triggers
    // only when the clickMovesCursor setting is on (a plain click otherwise has
    // jobs of its own: focus, select, open links). A drag makes a selection and
    // is left alone. Only fires at the bottom of the scrollback, where the live
    // cursor is.
    const moveTriggered = (e: MouseEvent): boolean => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) return false; // reserved for selection/links
      if (e.altKey) return true; // Option/Alt+click: always
      return useStore.getState().settings.clickMovesCursor ?? false; // plain click: opt-in
    };
    let clickMoveDownAt = -1;
    const onMoveMouseDown = (e: MouseEvent): void => { clickMoveDownAt = moveTriggered(e) ? e.timeStamp : -1; };
    const onMoveMouseUp = (e: MouseEvent): void => {
      if (clickMoveDownAt < 0 || !moveTriggered(e)) { clickMoveDownAt = -1; return; }
      const quick = e.timeStamp - clickMoveDownAt < 500; // long press → treat as selection
      clickMoveDownAt = -1;
      if (!quick || term.hasSelection()) return;
      const buf = term.buffer.active;
      if (buf.viewportY < buf.baseY) return; // scrolled up; the live cursor isn't on screen
      const screen = host.querySelector('.xterm-screen') as HTMLElement | null;
      if (!screen) return;
      const rect = screen.getBoundingClientRect();
      const cellW = rect.width / term.cols;
      const cellH = rect.height / term.rows;
      if (!(cellW > 0) || !(cellH > 0)) return;
      let col = Math.floor((e.clientX - rect.left) / cellW);
      let row = Math.floor((e.clientY - rect.top) / cellH);
      col = Math.min(Math.max(col, 0), term.cols - 1);
      row = Math.min(Math.max(row, 0), term.rows - 1);
      // Per-row content length + wrapped flag, so the move can count across
      // newlines. Indexed by the same viewport rows as the cursor/target cells.
      const rowsMeta: RowMeta[] = [];
      for (let y = 0; y < term.rows; y++) {
        const line = buf.getLine(buf.baseY + y);
        rowsMeta.push({ length: (line?.translateToString(true) ?? '').length, wrapped: line?.isWrapped ?? false });
      }
      // Don't overshoot into the empty space past the end of the clicked line.
      col = Math.min(col, rowsMeta[row].length);
      const seq = clickMoveSequence(
        rowsMeta,
        { x: buf.cursorX, y: buf.cursorY },
        { x: col, y: row },
        term.modes.applicationCursorKeysMode
      );
      if (seq) { window.api.input({ paneId, data: seq }); activity.onInput(); }
    };
    host.addEventListener('mousedown', onMoveMouseDown, true);
    host.addEventListener('mouseup', onMoveMouseUp, true);

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
    // PTY byte stream. SerializeAddon emits only the normal buffer — no alt-screen
    // contents, color-query replies, or cursor-jump sequences — so a restart
    // replays clean, reflowable history instead of control-character garbage.
    // Cap the exported scrollback so scrollback.json can't grow without bound.
    const SCROLLBACK_LINES = 1000;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const doSave = (): void => {
      const data = serializeAddon.serialize({ scrollback: SCROLLBACK_LINES });
      // Never persist the restore separator — serialize captures the rendered
      // buffer, so without this each restart's separator would be saved and they
      // would accumulate across restarts.
      const cleaned = data.split('\n').filter((line) => !line.includes(RESTORE_MARKER_TEXT)).join('\n');
      window.api.saveScrollback(paneId, cleaned);
    };
    const flushSave = (): void => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      doSave();
    };
    const scheduleSave = (): void => {
      if (saveTimer) return; // coalesce bursts of output into one write per second
      saveTimer = setTimeout(() => { saveTimer = null; doSave(); }, 1000);
    };

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
      scheduleSave();
      activity.onOutput();
    });
    const offExit = window.api.onExit(paneId, (exitCode) => {
      term.write(`\r\n[Process exited — code ${exitCode}]\r\n`);
    });
    const inputDisp = term.onData((data) => {
      window.api.input({ paneId, data });
      activity.onInput();
    });

    // Replay any saved scrollback once, before the fresh shell starts writing, so
    // restored history appears above the new prompt rather than interleaved with it.
    let restorePromise: Promise<void> | null = null;
    const restoreOnce = (): Promise<void> => {
      if (!restorePromise) {
        restorePromise = window.api.getScrollback(paneId).then((saved) => {
          if (saved) {
            term.write(saved);
            term.write(`\r\n\x1b[2m── ${RESTORE_MARKER_TEXT} ──\x1b[0m\r\n`);
          }
        });
      }
      return restorePromise;
    };

    let spawned = false;
    const spawnOnce = () => {
      if (spawned) return;
      spawned = true;
      void restoreOnce().then(() => {
        window.api.spawn({ paneId, cwd, cols: term.cols || 80, rows: term.rows || 24 });
        // One-shot startup command for a pane created from a template. Consuming
        // clears it (and persists) so it never runs again after a restart. The
        // PTY buffers the input until the shell is ready to read it.
        const command = useStore.getState().consumeStartupCommand(paneId);
        if (command) {
          window.api.input({ paneId, data: `${command}\r` });
          activity.onInput();
        }
      });
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

    const resize = () => {
      if (safeFit()) {
        spawnOnce();
        window.api.resize({ paneId, cols: term.cols, rows: term.rows });
      }
    };
    // Observe the wrapper, not the host: safeFit pins the host to a fixed pixel
    // height, so a height-only pane resize (splitter drag, maximize) never
    // changes the host's size and would never fire the observer. The wrapper
    // always tracks the pane layout and is never pinned.
    const ro = new ResizeObserver(resize);
    ro.observe(host.parentElement ?? host);

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
      flushSave();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      ro.disconnect();
      cancelAnimationFrame(pinRaf);
      host.removeEventListener('keydown', handleTerminalPasteShortcut, true);
      host.removeEventListener('mousedown', onMoveMouseDown, true);
      host.removeEventListener('mouseup', onMoveMouseUp, true);
      offData();
      offExit();
      inputDisp.dispose();
      scrollDisp.dispose();
      activity.dispose();
      unregisterSearch(paneId);
      unregisterTerminal(paneId);
      unregisterTerminalFocus(paneId);
      webgl?.dispose();
      term.dispose();
      termRef.current = null;
    };
    // paneId is stable for the component's lifetime; cwd only matters at spawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  // Apply theme changes live (theme / opacity / background override) without
  // recreating the terminal.
  useEffect(() => {
    const term = termRef.current;
    if (term) {
      term.options.theme = buildTheme(themeId, opacity, customBg);
      syncBackgrounds(hostRef.current, bgColor(themeId, opacity, customBg));
    }
  }, [themeId, opacity, customBg]);

  const scrollToBottom = (): void => { termRef.current?.scrollToBottom(); };

  const menuItems = (): MenuItem[] => {
    const term = termRef.current;
    const hasSelection = !!term?.hasSelection();
    return [
      {
        label: 'Copy',
        disabled: !hasSelection,
        // Refocus the terminal: clicking a menu button moves focus onto the
        // button, and on close it falls to <body>, not back to xterm's hidden
        // textarea — so keystrokes (e.g. Enter after Paste) are dropped until
        // the user clicks into the terminal. term.focus() restores it.
        onClick: () => { const sel = term?.getSelection(); if (sel) window.api.clipboardWrite(sel); term?.focus(); }
      },
      {
        label: 'Paste',
        onClick: async () => {
          const text = await window.api.clipboardRead();
          if (text) term?.paste(text);
          term?.focus();
        }
      },
      { label: 'Select All', onClick: () => { term?.selectAll(); term?.focus(); } },
      { label: '-' },
      { label: 'Clear Window', onClick: () => { clearTerminal(paneId); term?.focus(); } },
      { label: 'Clear All Windows', onClick: () => setConfirmClearAll(true) },
      { label: '-' },
      { label: 'Search', onClick: () => setSearchOpen(paneId) },
      { label: 'Close Terminal', onClick: () => closeActivePane(paneId) }
    ];
  };

  return (
    <div
      className="xterm-host-wrap"
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
    >
      <div className="xterm-host" ref={hostRef} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
      {confirmClearAll && (
        <ConfirmDialog
          title="Clear all windows?"
          message="All panes in this workspace will be cleared and their scrollback history lost."
          confirmLabel="Clear all"
          onConfirm={() => {
            const ws = useStore.getState().activeWorkspace();
            clearTerminals(collectPaneIds(ws?.layout ?? null));
            setConfirmClearAll(false);
          }}
          onCancel={() => setConfirmClearAll(false)}
        />
      )}
      {!atBottom && (
        <button className="scroll-bottom-btn" title="Scroll to bottom" onClick={scrollToBottom}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6l4 4 4-4" />
            <path d="M4 11h8" />
          </svg>
        </button>
      )}
    </div>
  );
}
