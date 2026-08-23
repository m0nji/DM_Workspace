import { describe, it, expect } from 'vitest';
import { applyTabDrop, normalizeGroups, type GroupedList } from '../src/shared/workspace-groups';
import type { Workspace, WorkspaceGroup } from '../src/shared/types';

function ws(id: string, groupId?: string, color?: string): Workspace {
  return {
    id,
    name: id.toUpperCase(),
    cwd: `/tmp/${id}`,
    layout: { type: 'pane', id: `p-${id}` },
    ...(groupId ? { groupId } : {}),
    ...(color ? { color } : {})
  };
}

function grp(id: string, extra: Partial<WorkspaceGroup> = {}): WorkspaceGroup {
  return { id, name: '', ...extra };
}

function list(workspaces: Workspace[], groups: WorkspaceGroup[] = []): GroupedList {
  return { workspaces, groups };
}

/** Compact view of a list: ids in order, each with its group. */
function shape(l: GroupedList): string {
  return l.workspaces.map((w) => (w.groupId ? `${w.id}:${w.groupId}` : w.id)).join(' ');
}

function ids(l: GroupedList): string[] {
  return l.groups.map((g) => g.id);
}

let counter = 0;
const newGroupId = (): string => `g${++counter}`;

describe('normalizeGroups', () => {
  it('drops a groupId that names no group', () => {
    const out = normalizeGroups(list([ws('a', 'gone'), ws('b')]));
    expect(shape(out)).toBe('a b');
  });

  it('drops a group that has no members', () => {
    const out = normalizeGroups(list([ws('a')], [grp('g1'), grp('g2')]));
    expect(ids(out)).toEqual([]);
  });

  it('pulls a scattered group together at its first member', () => {
    const out = normalizeGroups(list([ws('a', 'g1'), ws('b'), ws('c', 'g1')], [grp('g1')]));
    expect(shape(out)).toBe('a:g1 c:g1 b');
  });

  it('leaves an already valid list untouched, identities included', () => {
    const input = list([ws('a', 'g1'), ws('b', 'g1'), ws('c')], [grp('g1')]);
    const out = normalizeGroups(input);
    expect(out.workspaces).toBe(input.workspaces);
    expect(out.groups).toBe(input.groups);
  });

  it('does not mutate its input', () => {
    const input = list([ws('a', 'g1'), ws('b'), ws('c', 'g1')], [grp('g1')]);
    const before = shape(input);
    normalizeGroups(input);
    expect(shape(input)).toBe(before);
  });
});

describe('applyTabDrop', () => {
  it('makes a new group from two loose registers, target first', () => {
    counter = 0;
    const out = applyTabDrop(list([ws('a'), ws('b'), ws('c')]), 'c', { kind: 'workspace', id: 'a' }, 'into', newGroupId);
    expect(shape(out)).toBe('a:g1 c:g1 b');
    expect(ids(out)).toEqual(['g1']);
  });

  it('borrows the target register colour for the new group', () => {
    counter = 0;
    const out = applyTabDrop(list([ws('a', undefined, '#a05ac9'), ws('b')]), 'b', { kind: 'workspace', id: 'a' }, 'into', newGroupId);
    expect(out.groups[0]).toMatchObject({ id: 'g1', name: '', color: '#a05ac9' });
  });

  it('joins the target group when dropped onto a member', () => {
    const input = list([ws('a', 'g1'), ws('b', 'g1'), ws('c')], [grp('g1')]);
    const out = applyTabDrop(input, 'c', { kind: 'workspace', id: 'a' }, 'into', newGroupId);
    expect(shape(out)).toBe('a:g1 c:g1 b:g1');
  });

  it('appends to the group when dropped onto its chip', () => {
    const input = list([ws('a', 'g1'), ws('b', 'g1'), ws('c')], [grp('g1')]);
    const out = applyTabDrop(input, 'c', { kind: 'group', id: 'g1' }, 'into', newGroupId);
    expect(shape(out)).toBe('a:g1 b:g1 c:g1');
  });

  it('reorders inside a group without leaving it', () => {
    const input = list([ws('a', 'g1'), ws('b', 'g1'), ws('c', 'g1')], [grp('g1')]);
    const out = applyTabDrop(input, 'c', { kind: 'workspace', id: 'b' }, 'before', newGroupId);
    expect(shape(out)).toBe('a:g1 c:g1 b:g1');
  });

  it('leaves the group when dropped before its first member', () => {
    const input = list([ws('a', 'g1'), ws('b', 'g1'), ws('c', 'g1')], [grp('g1')]);
    const out = applyTabDrop(input, 'c', { kind: 'workspace', id: 'a' }, 'before', newGroupId);
    expect(shape(out)).toBe('c a:g1 b:g1');
  });

  it('leaves the group when dropped after its last member', () => {
    const input = list([ws('a', 'g1'), ws('b', 'g1'), ws('c', 'g1')], [grp('g1')]);
    const out = applyTabDrop(input, 'a', { kind: 'workspace', id: 'c' }, 'after', newGroupId);
    expect(shape(out)).toBe('b:g1 c:g1 a');
  });

  it('stays ungrouped when reordering among loose registers', () => {
    const out = applyTabDrop(list([ws('a'), ws('b'), ws('c')]), 'c', { kind: 'workspace', id: 'a' }, 'before', newGroupId);
    expect(shape(out)).toBe('c a b');
    expect(ids(out)).toEqual([]);
  });

  it('dissolves the old group when the dragged register was its last member', () => {
    const input = list([ws('a', 'g1'), ws('b', 'g2'), ws('c', 'g2')], [grp('g1'), grp('g2')]);
    const out = applyTabDrop(input, 'a', { kind: 'workspace', id: 'b' }, 'into', newGroupId);
    expect(shape(out)).toBe('b:g2 a:g2 c:g2');
    expect(ids(out)).toEqual(['g2']);
  });

  it('is a no-op when dropped on itself', () => {
    const input = list([ws('a'), ws('b')]);
    expect(applyTabDrop(input, 'a', { kind: 'workspace', id: 'a' }, 'into', newGroupId)).toBe(input);
  });

  it('is a no-op for an unknown dragged or target id', () => {
    const input = list([ws('a'), ws('b')]);
    expect(applyTabDrop(input, 'zz', { kind: 'workspace', id: 'a' }, 'into', newGroupId)).toBe(input);
    expect(applyTabDrop(input, 'a', { kind: 'workspace', id: 'zz' }, 'into', newGroupId)).toBe(input);
    expect(applyTabDrop(input, 'a', { kind: 'group', id: 'zz' }, 'into', newGroupId)).toBe(input);
  });

  it('is a no-op when dropped on the chip of the group it is alone in', () => {
    const input = list([ws('a', 'g1'), ws('b')], [grp('g1')]);
    expect(applyTabDrop(input, 'a', { kind: 'group', id: 'g1' }, 'into', newGroupId)).toBe(input);
  });

  it('does not spend a group id on a drop that groups nothing', () => {
    counter = 0;
    applyTabDrop(list([ws('a'), ws('b')]), 'b', { kind: 'workspace', id: 'a' }, 'before', newGroupId);
    expect(counter).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = list([ws('a'), ws('b'), ws('c')]);
    const before = shape(input);
    applyTabDrop(input, 'c', { kind: 'workspace', id: 'a' }, 'into', newGroupId);
    expect(shape(input)).toBe(before);
    expect(input.groups).toEqual([]);
  });

  it('keeps every group contiguous, whatever the drop', () => {
    const input = list(
      [ws('a', 'g1'), ws('b', 'g1'), ws('c'), ws('d', 'g2'), ws('e', 'g2')],
      [grp('g1'), grp('g2')]
    );
    const drops: Array<[string, string, 'before' | 'into' | 'after']> = [
      ['a', 'd', 'into'], ['e', 'a', 'before'], ['c', 'b', 'after'], ['d', 'c', 'into'], ['b', 'e', 'after']
    ];
    for (const [dragged, targetId, intent] of drops) {
      const out = applyTabDrop(input, dragged, { kind: 'workspace', id: targetId }, intent, newGroupId);
      for (const g of out.groups) {
        const at = out.workspaces.map((w, i) => (w.groupId === g.id ? i : -1)).filter((i) => i >= 0);
        expect(at.length, `group ${g.id} must have members after ${dragged}->${targetId}/${intent}`).toBeGreaterThan(0);
        expect(at[at.length - 1] - at[0], `group ${g.id} must stay contiguous after ${dragged}->${targetId}/${intent}`)
          .toBe(at.length - 1);
      }
      expect(out.workspaces.map((w) => w.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    }
  });
});
