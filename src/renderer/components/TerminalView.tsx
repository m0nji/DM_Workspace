import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import { useStore } from '../store';
import { getTheme } from '../../shared/themes';
import { createPaneActivity } from '../pane-activity';
import { registerSearch, unregisterSearch } from '../search-registry';
import { parseOsc7, parseOsc9 } from '../../shared/osc-cwd';
import { ContextMenu, type MenuItem } from './ContextMenu';

interface Props { paneId: string; cwd: string; }

const RESTORE_MARKER_TEXT = 'vorherige Sitzung wiederhergestellt (Prozess neu gestartet)';

// Build an xterm ITheme from a theme id + opacity. The background can be
// overridden (customBg) while the theme still supplies foreground/cursor/ANSI.
// Opacity is applied to the background only (so a translucent terminal reveals
// the window vibrancy).
function buildTheme(themeId: string, opacity: number, customBg?: string): ITheme {
  const t = getTheme(themeId);
  const a = Math.min(1, Math.max(0, opacity));
  const bgHex = customBg ?? t.background;
  let background = bgHex;
  const m = /^#?([0-9a-f]{6})$/i.exec(bgHex.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    background = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const [
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite
  ] = t.ansi;
  return {
    background, foreground: t.foreground, cursor: t.cursor,
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite
  };
}

export function TerminalView({ paneId, cwd }: Props): JSX.Element {
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
      cursorBlink: true
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

    const safeFit = (): boolean => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        fit.fit();
        return true;
      }
      return false;
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
      });
    };

    // Fit + spawn after the flex layout has settled so the PTY starts at the
    // real terminal size and the first prompt renders correctly.
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => { safeFit(); spawnOnce(); });
    });

    const resize = () => {
      if (safeFit()) {
        spawnOnce();
        window.api.resize({ paneId, cols: term.cols, rows: term.rows });
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    return () => {
      flushSave();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      ro.disconnect();
      offData();
      offExit();
      inputDisp.dispose();
      scrollDisp.dispose();
      activity.dispose();
      unregisterSearch(paneId);
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
        onClick: () => { const sel = term?.getSelection(); if (sel) window.api.clipboardWrite(sel); }
      },
      {
        label: 'Paste',
        onClick: async () => {
          const text = await window.api.clipboardRead();
          if (text) window.api.input({ paneId, data: text });
        }
      },
      { label: 'Select All', onClick: () => term?.selectAll() },
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
