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

// Called from the portal's unmount cleanup. That fires for two very different
// reasons and cannot tell them apart on its own:
//
//   * the pane is truly gone (closed, workspace deleted) — its slot went with
//     it, so the container is no longer in the document and must be dropped;
//   * the workspace view was REMOUNTED around a pane that still exists (some
//     ancestor changed shape). React runs the new slot's layout effect — which
//     re-adopts this very container — before the old portal's cleanup, so by
//     the time we get here a live slot already holds it.
//
// The document answers the question: a container a mounted slot holds is in
// use. Dropping it there would strand the terminal in an orphaned div — panes
// go blank and no toggle brings them back (see the placement e2e spec). Slots
// adopt exclusively (PaneSlot replaces its content), so a container left behind
// by a slot that moved on is detached and gets released normally.
export function releasePaneHost(paneId: string): void {
  const el = hosts.get(paneId);
  if (!el || el.isConnected) return;
  el.remove();
  hosts.delete(paneId);
}
