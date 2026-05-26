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
    fit.fit();

    void window.api.spawn({ paneId, cwd, cols: term.cols, rows: term.rows });

    const offData = window.api.onData((e) => { if (e.paneId === paneId) term.write(e.data); });
    const offExit = window.api.onExit((e) => {
      if (e.paneId === paneId) term.write(`\r\n[Process exited — code ${e.exitCode}]\r\n`);
    });
    const inputDisp = term.onData((data) => window.api.input({ paneId, data }));

    const resize = () => {
      fit.fit();
      window.api.resize({ paneId, cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    return () => {
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
