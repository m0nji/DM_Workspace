// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { acquirePaneHost, releasePaneHost } from '../src/renderer/pane-host';

// Mimics what LayoutRenderer's PaneSlot does: a slot in the live document that
// adopts the pane's container.
function mountSlot(paneId: string): HTMLDivElement {
  const slot = document.createElement('div');
  slot.className = 'pane-slot';
  document.body.appendChild(slot);
  slot.replaceChildren(acquirePaneHost(paneId));
  return slot;
}

describe('pane host registry', () => {
  it('hands out one stable container per pane', () => {
    const first = acquirePaneHost('stable');
    expect(acquirePaneHost('stable')).toBe(first);
    releasePaneHost('stable');
  });

  it('drops the container once no slot holds it any more', () => {
    const slot = mountSlot('closed');
    const host = acquirePaneHost('closed');

    // Closing a pane removes its slot from the layout; the container goes with it.
    slot.remove();
    releasePaneHost('closed');

    expect(host.isConnected).toBe(false);
    // A future pane starts clean instead of inheriting the dead terminal's DOM.
    expect(acquirePaneHost('closed')).not.toBe(host);
    releasePaneHost('closed');
  });

  // The release call cannot see WHY the portal unmounted. If the workspace view
  // is remounted (an ancestor changing shape, e.g. the navigation placement
  // swapping the app shell), React runs the new slot's layout effect — which
  // re-adopts this very container — BEFORE the old portal's cleanup. Detaching
  // it there would leave the terminal in an orphaned div: panes go blank and no
  // toggle brings them back. A container a live slot still holds is in use.
  it('keeps a container that a live slot has already re-adopted', () => {
    const host = acquirePaneHost('remounted');
    mountSlot('remounted'); // the fresh slot adopts the same container
    releasePaneHost('remounted');

    expect(host.isConnected).toBe(true);
    expect(acquirePaneHost('remounted')).toBe(host);
    expect(document.querySelector('.pane-slot')!.firstChild).toBe(host);
  });
});
