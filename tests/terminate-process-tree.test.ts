import { expect, it, vi } from 'vitest';
import { descendantPids, terminateProcessTree } from '../src/main/terminate-process-tree';
it('orders owned descendants before parents and excludes unrelated processes', () => {
  const tree = '10 1\n20 10\n30 20\n40 10\n50 1\n60 50\n';
  expect(descendantPids(tree, 10)).toEqual([30, 20, 40]);
});
it('rejects invalid and replaced roots before any process operation', async () => {
  const kill = vi.spyOn(process, 'kill');
  try {
    await expect(terminateProcessTree(1, () => true)).rejects.toThrow('Invalid');
    await expect(terminateProcessTree(process.pid, () => true)).rejects.toThrow('Invalid');
    await expect(terminateProcessTree(23456, () => false)).rejects.toThrow('changed');
    expect(kill).not.toHaveBeenCalled();
  } finally { kill.mockRestore(); }
});
