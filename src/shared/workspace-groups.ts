// Where a dropped workspace register lands, and which group it belongs to
// afterwards. Pure: the store hands in the list, gets a new one back, and does
// nothing but persist it.
//
// Two invariants hold for every value this module returns, and `normalizeGroups`
// is what establishes them — it runs at the end of every drop and again when a
// state is loaded from disk, because a file on disk is not to be trusted:
//
//  1. Contiguity. All members of a group sit next to each other in the array.
//     The navigation renders the array in order, and three other places treat
//     "array position" and "displayed position" as the same thing — Mod+1..9,
//     the command palette's shortcut hint, and reordering. Keeping members
//     adjacent is what lets those keep working untouched.
//  2. Referential sanity. Every `groupId` names a group that exists, and every
//     group has at least one member. Deleting a workspace — or removing a
//     server, which deletes its remote workspaces silently — can otherwise
//     leave a group behind with nothing in it.

import type { Workspace, WorkspaceGroup } from './types';
import type { TabDropIntent } from './tab-drop-intent';

export interface GroupedList {
  workspaces: Workspace[];
  groups: WorkspaceGroup[];
}

/** A register, or the chip that heads a group. */
export type DropTarget =
  | { kind: 'workspace'; id: string }
  | { kind: 'group'; id: string };

// Returns the same object when the membership already matches, so React sees
// unchanged identities for the registers a drop did not touch.
function withGroup(w: Workspace, groupId: string | undefined): Workspace {
  if (w.groupId === groupId) return w;
  const next = { ...w };
  if (groupId === undefined) delete next.groupId;
  else next.groupId = groupId;
  return next;
}

function memberIndices(workspaces: Workspace[], groupId: string): number[] {
  const out: number[] = [];
  workspaces.forEach((w, i) => { if (w.groupId === groupId) out.push(i); });
  return out;
}

/**
 * Repair a list into one that satisfies both invariants. Safe to call on
 * anything, including a state read straight off disk.
 */
export function normalizeGroups(list: GroupedList): GroupedList {
  const known = new Set(list.groups.map((g) => g.id));
  const cleaned = list.workspaces.map((w) =>
    w.groupId !== undefined && !known.has(w.groupId) ? withGroup(w, undefined) : w
  );

  const populated = new Set(
    cleaned.map((w) => w.groupId).filter((id): id is string => id !== undefined)
  );
  const groups = list.groups.filter((g) => populated.has(g.id));

  // Pull each group's members together at the position of its first member, in
  // their existing relative order. Anchoring on the first member rather than
  // the group's position in `groups` keeps a repair as close as possible to
  // what the user last saw.
  const taken = new Set<number>();
  const ordered: Workspace[] = [];
  cleaned.forEach((w, i) => {
    if (taken.has(i)) return;
    taken.add(i);
    ordered.push(w);
    if (w.groupId === undefined) return;
    cleaned.forEach((other, j) => {
      if (j <= i || taken.has(j) || other.groupId !== w.groupId) return;
      taken.add(j);
      ordered.push(other);
    });
  });

  const sameWorkspaces =
    ordered.length === list.workspaces.length && ordered.every((w, i) => w === list.workspaces[i]);
  return {
    workspaces: sameWorkspaces ? list.workspaces : ordered,
    groups: groups.length === list.groups.length ? list.groups : groups
  };
}

/**
 * Apply one drop. `newGroupId` is only called when a group is actually created,
 * so the caller's id counter does not advance on drops that group nothing.
 *
 * Dropping onto a group's chip always appends to that group, whatever the
 * intent says: the chip is a small element, and splitting it into thirds would
 * put two different meanings inside a few pixels of each other.
 */
export function applyTabDrop(
  list: GroupedList,
  draggedId: string,
  target: DropTarget,
  intent: TabDropIntent,
  newGroupId: () => string
): GroupedList {
  if (target.kind === 'workspace' && target.id === draggedId) return list;

  const base = normalizeGroups(list);
  const dragged = base.workspaces.find((w) => w.id === draggedId);
  if (!dragged) return list;

  // Own array (filter allocates), so the `into` branch below may write into it.
  const rest = base.workspaces.filter((w) => w.id !== draggedId);
  let groups = base.groups;
  let insertAt: number;
  let nextGroupId: string | undefined;

  if (target.kind === 'group') {
    const group = groups.find((g) => g.id === target.id);
    if (!group) return list;
    const members = memberIndices(rest, group.id);
    // The chip only existed because the dragged register was in it, and it was
    // the last one. There is no group left to append to.
    if (members.length === 0) return list;
    insertAt = members[members.length - 1] + 1;
    nextGroupId = group.id;
  } else {
    const ti = rest.findIndex((w) => w.id === target.id);
    if (ti < 0) return list;
    const t = rest[ti];

    if (intent === 'into') {
      if (t.groupId !== undefined) {
        nextGroupId = t.groupId;
      } else {
        // Two loose registers become a group. It starts unnamed — the chip goes
        // straight into inline editing — and borrows the target's colour, so no
        // colour has to be picked before the group exists.
        nextGroupId = newGroupId();
        groups = [...groups, { id: nextGroupId, name: '', ...(t.color ? { color: t.color } : {}) }];
        rest[ti] = withGroup(t, nextGroupId);
      }
      insertAt = ti + 1;
    } else {
      insertAt = intent === 'before' ? ti : ti + 1;
      const g = t.groupId;
      if (g === undefined) {
        nextGroupId = undefined;
      } else {
        // Landing strictly inside a group's run joins it; landing on its outer
        // edge leaves it. That is the only unambiguous reading of a drop at a
        // boundary, and it is how a member is dragged back out.
        const members = memberIndices(rest, g);
        const atOuterEdge =
          (intent === 'before' && ti === members[0]) ||
          (intent === 'after' && ti === members[members.length - 1]);
        nextGroupId = atOuterEdge ? undefined : g;
      }
    }
  }

  const next = [...rest];
  next.splice(insertAt, 0, withGroup(dragged, nextGroupId));
  // Normalize again: the dragged register may have been the last member of its
  // previous group, which now has to go.
  return normalizeGroups({ workspaces: next, groups });
}
