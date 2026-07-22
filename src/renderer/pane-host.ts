// Stable DOM containers for pane content, keyed by paneId.
//
// React remounts a layout subtree when the tree's SHAPE changes around it — a
// pane becoming a split's child on the first split, or a split collapsing back
// to a bare pane on close. Element identity at that tree position changes, and
// keys cannot save it. If the terminal lived directly in that subtree it would
// be torn down and rebuilt: the fresh xterm replays the serialized scrollback
// (hard-wrapped at the OLD width, plus the session-restore marker) while the
// still-running PTY program keeps repainting via cursor movements into what it
// believes is its previous screen — the two interleave and shred the pane.
//
// Instead each pane's content renders through a React portal into a container
// from this registry. Layout changes only re-create the lightweight slot <div>
// the container is plugged into; the container — and the live xterm inside it —
// is MOVED in the DOM, never destroyed. (Canvas contents survive same-document
// moves, so even the WebGL renderer carries over.)
const hosts = new Map<string, HTMLDivElement>();

export function acquirePaneHost(paneId: string): HTMLDivElement {
  let el = hosts.get(paneId);
  if (!el) {
    el = document.createElement('div');
    el.className = 'pane-portal-host';
    hosts.set(paneId, el);
  }
  return el;
}

// Called when a pane is truly gone (closed, workspace deleted) — after the
// portal content unmounted. Dropping the map entry lets a future pane with a
// fresh id start clean; removing the node detaches it from any slot.
export function releasePaneHost(paneId: string): void {
  hosts.get(paneId)?.remove();
  hosts.delete(paneId);
}
