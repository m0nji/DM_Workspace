import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fail = vi.hoisted(() => ({ next: true }));
vi.mock('node:http', async importOriginal => {
  const original = await importOriginal<typeof import('node:http')>();
  return { ...original, createServer: (...args: Parameters<typeof original.createServer>) => {
    const server = original.createServer(...args);
    if (fail.next) {
      fail.next = false;
      vi.spyOn(server, 'listen').mockImplementation(() => {
        queueMicrotask(() => server.emit('error', new Error('temporary bind failure')));
        return server;
      });
    }
    return server;
  } };
});
import { AgentStatusBridge } from '../src/main/agent-status-bridge';

it('can retry after a transient loopback bind failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-retry-'));
  const bridge = new AgentStatusBridge(dir, () => {});
  try {
    await expect(bridge.prepare('p', '/bin/sh', 'a'.repeat(64))).rejects.toThrow('temporary bind failure');
    await expect(bridge.prepare('p', '/bin/sh', 'a'.repeat(64))).resolves.toHaveProperty('launchCommand');
  } finally { await bridge.close(); rmSync(dir, { recursive: true, force: true }); }
});
