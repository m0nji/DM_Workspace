import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { AgentProfile } from '../../shared/agent-profiles';
import type { Direction } from '../../shared/types';
import { newPaneMenuEntries, type NewPaneMenuEntry } from '../new-pane-menu';
import { AgentLogo } from './AgentLogo';

interface Props {
  anchor: DOMRect;
  profiles: AgentProfile[];
  remote: boolean;
  terminalBlockedReason: string | null; // remote create limits, same text as before
  onOpen: (entry: NewPaneMenuEntry, direction: Direction) => void;
  onManage: () => void;
  onClose: () => void;
}

export function NewPaneMenu({ anchor, profiles, remote, terminalBlockedReason, onOpen, onManage, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const entries = newPaneMenuEntries(profiles, remote);
  const menuRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ x: anchor.left, y: anchor.bottom + 4 });
  const count = entries.length + 1; // last row: manage agents

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(anchor.right - r.width, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(anchor.bottom + 4, window.innerHeight - r.height - 4))
    });
  }, [anchor]);
  useEffect(() => { rowRefs.current[0]?.focus(); }, []);
  useEffect(() => {
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    // Capture: scroll does not bubble, and any scrolled container moves the anchor.
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const isOff = (entry: NewPaneMenuEntry): boolean => entry.disabled || (entry.kind === 'terminal' && !!terminalBlockedReason);
  const move = (index: number): void => { const i = (index + count) % count; setActive(i); rowRefs.current[i]?.focus(); };
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(active + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(active - 1); }
    else if (event.key === 'Home') { event.preventDefault(); move(0); }
    else if (event.key === 'End') { event.preventDefault(); move(count - 1); }
    else if (event.key === 'Tab') { event.preventDefault(); move(active + (event.shiftKey ? -1 : 1)); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (active === entries.length) { onManage(); return; }
      const entry = entries[active];
      if (entry && !isOff(entry)) onOpen(entry, event.shiftKey ? 'v' : 'h');
    }
  };

  return createPortal(<>
    <div className="context-menu-backdrop" onMouseDown={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
    <div ref={menuRef} className="new-pane-menu" role="menu" aria-label={t('pane.newPaneMenu.title')}
      style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown}>
      {entries.map((entry, i) => {
        const name = entry.kind === 'terminal' ? t('pane.newPaneMenu.terminal') : entry.profile.name;
        const off = isOff(entry);
        const reason = entry.kind === 'terminal' ? terminalBlockedReason : entry.disabled ? t('pane.newPaneMenu.localOnly') : null;
        return <div key={entry.key} className={`new-pane-row ${off ? 'disabled' : ''}`} title={reason ?? undefined}>
          <button ref={el => { rowRefs.current[i] = el; }} type="button" role="menuitem" className="new-pane-main"
            tabIndex={-1} aria-disabled={off} onFocus={() => setActive(i)} onClick={() => { if (!off) onOpen(entry, 'h'); }}>
            {entry.kind === 'terminal'
              ? <span className="new-pane-terminal-icon" aria-hidden="true">&gt;_</span>
              : <AgentLogo icon={entry.profile.icon} name={name} decorative />}
            <span className="new-pane-name">{name}</span>
          </button>
          <button type="button" className="pane-btn" tabIndex={-1} disabled={off}
            aria-label={t('pane.newPaneMenu.right', { name })} title={t('pane.newPaneMenu.right', { name })}
            onClick={() => onOpen(entry, 'h')}>→</button>
          <button type="button" className="pane-btn" tabIndex={-1} disabled={off}
            aria-label={t('pane.newPaneMenu.below', { name })} title={t('pane.newPaneMenu.below', { name })}
            onClick={() => onOpen(entry, 'v')}>↓</button>
        </div>;
      })}
      <div className="context-menu-sep" />
      <button ref={el => { rowRefs.current[entries.length] = el; }} type="button" role="menuitem" className="new-pane-manage"
        tabIndex={-1} onFocus={() => setActive(entries.length)} onClick={onManage}>{t('pane.newPaneMenu.manage')}</button>
    </div>
  </>, document.querySelector('.root') ?? document.body);
}
