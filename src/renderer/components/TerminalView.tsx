import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

interface Props { paneId: string; cwd: string; }

export function TerminalView({ paneId, cwd }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({
      fontFamily: 'Menlo, "Cascadia Mono", monospace',
      fontSize: 13,
      theme: { background: '#0d0d0d', foreground: '#ddd' },
      cursorBlink: true
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try { term.loadAddon(new WebglAddon()); } catch { /* fallback to canvas */ }

    // Only fit when the host actually has a size. Inactive workspaces are mounted
    // but hidden (display:none → 0×0), where fit would compute garbage dims.
    const safeFit = (): boolean => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        fit.fit();
        return true;
      }
      return false;
    };

    // Attach listeners BEFORE spawning so the shell's first output (the prompt)
    // is never missed.
    const offData = window.api.onData((e) => { if (e.paneId === paneId) term.write(e.data); });
    const offExit = window.api.onExit((e) => {
      if (e.paneId === paneId) term.write(`\r\n[Process exited — code ${e.exitCode}]\r\n`);
    });
    const inputDisp = term.onData((data) => window.api.input({ paneId, data }));

    let spawned = false;
    const spawnOnce = () => {
      if (spawned) return;
      spawned = true;
      void window.api.spawn({ paneId, cwd, cols: term.cols || 80, rows: term.rows || 24 });
    };

    // Fit + spawn AFTER the browser has applied the flex layout (two animation
    // frames), so the PTY starts at the real terminal size and the first prompt
    // renders correctly instead of leaving the pane blank.
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        safeFit();
        spawnOnce();
      });
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
    };
    // paneId is stable for the component's lifetime; cwd only matters at spawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  return <div className="xterm-host" ref={hostRef} />;
}
