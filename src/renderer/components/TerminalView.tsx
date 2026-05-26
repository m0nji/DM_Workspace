import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useStore } from '../store';

interface Props { paneId: string; cwd: string; }

// '#0d0d0d' + opacity 0.8 -> 'rgba(13,13,13,0.8)'. Falls back to opaque on bad input.
function toBackground(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const a = Math.min(1, Math.max(0, opacity));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
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
      theme: { background: toBackground(background, opacity), foreground: '#ddd' },
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

    // Attach listeners BEFORE spawning so the shell's first prompt is never missed.
    const offData = window.api.onData(paneId, (data) => term.write(data));
    const offExit = window.api.onExit(paneId, (exitCode) => {
      term.write(`\r\n[Process exited — code ${exitCode}]\r\n`);
    });
    const inputDisp = term.onData((data) => window.api.input({ paneId, data }));

    let spawned = false;
    const spawnOnce = () => {
      if (spawned) return;
      spawned = true;
      void window.api.spawn({ paneId, cwd, cols: term.cols || 80, rows: term.rows || 24 });
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
      term.options.theme = { background: toBackground(background, opacity), foreground: '#ddd' };
    }
  }, [background, opacity]);

  return <div className="xterm-host" ref={hostRef} />;
}
