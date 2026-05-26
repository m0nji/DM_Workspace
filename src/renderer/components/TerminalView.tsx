import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useStore } from '../store';

interface Props { paneId: string; cwd: string; }

interface XtermTheme { background: string; foreground: string; cursor: string; }

// Build an xterm theme from a hex background + opacity. The foreground (and cursor)
// flip to dark on light backgrounds so text stays readable (e.g. white / light gray).
function themeFor(hex: string, opacity: number): XtermTheme {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { background: hex, foreground: '#dddddd', cursor: '#dddddd' };
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const a = Math.min(1, Math.max(0, opacity));
  // Perceived luminance (0..255); >150 counts as "light".
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const light = luminance > 150;
  return {
    background: `rgba(${r}, ${g}, ${b}, ${a})`,
    foreground: light ? '#1a1a1a' : '#dddddd',
    cursor: light ? '#1a1a1a' : '#dddddd'
  };
}

export function TerminalView({ paneId, cwd }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const background = useStore((s) => s.settings.terminalBackground);
  const opacity = useStore((s) => s.settings.terminalOpacity);

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({
      fontFamily: 'Menlo, "Cascadia Mono", monospace',
      fontSize: 13,
      // allowTransparency lets the terminal background blend with the window
      // vibrancy when opacity < 1. (We use the default renderer, which supports
      // transparency — the WebGL renderer forces an opaque background.)
      allowTransparency: true,
      theme: themeFor(background, opacity),
      cursorBlink: true
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const safeFit = (): boolean => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        fit.fit();
        return true;
      }
      return false;
    };

    // Rolling capture of raw PTY output so it can be replayed after a restart.
    // The PTY process itself does not survive a restart (it's killed on quit and
    // a fresh shell is spawned), so this restores the *visible history* only — it
    // re-feeds the saved bytes to xterm, which re-renders them. Capped so the
    // buffer (and the persisted file) can't grow without bound.
    const MAX_BUFFER = 256 * 1024;
    let buffer = '';
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const flushSave = () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      window.api.saveScrollback(paneId, buffer);
    };
    const scheduleSave = () => {
      if (saveTimer) return; // coalesce bursts of output into one write per second
      saveTimer = setTimeout(() => { saveTimer = null; window.api.saveScrollback(paneId, buffer); }, 1000);
    };
    const capture = (data: string) => {
      buffer += data;
      if (buffer.length > MAX_BUFFER) buffer = buffer.slice(buffer.length - MAX_BUFFER);
      scheduleSave();
    };

    // Attach listeners BEFORE spawning so the shell's first prompt is never missed.
    const offData = window.api.onData(paneId, (data) => { term.write(data); capture(data); });
    const offExit = window.api.onExit(paneId, (exitCode) => {
      term.write(`\r\n[Process exited — code ${exitCode}]\r\n`);
    });
    const inputDisp = term.onData((data) => window.api.input({ paneId, data }));

    // Replay any saved scrollback once, before the fresh shell starts writing, so
    // restored history appears above the new prompt rather than interleaved with it.
    let restorePromise: Promise<void> | null = null;
    const restoreOnce = (): Promise<void> => {
      if (!restorePromise) {
        restorePromise = window.api.getScrollback(paneId).then((saved) => {
          if (saved) {
            term.write(saved);
            buffer = saved;
            term.write('\r\n\x1b[2m── vorherige Sitzung wiederhergestellt (Prozess neu gestartet) ──\x1b[0m\r\n');
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
      term.dispose();
      termRef.current = null;
    };
    // paneId is stable for the component's lifetime; cwd only matters at spawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  // Apply theme changes live (background color / opacity) without recreating the terminal.
  useEffect(() => {
    const term = termRef.current;
    if (term) {
      term.options.theme = themeFor(background, opacity);
    }
  }, [background, opacity]);

  return <div className="xterm-host" ref={hostRef} />;
}
