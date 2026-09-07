import { expect, it, vi } from 'vitest';
const processes = vi.hoisted(() => [] as Array<{ exit: (event: { exitCode: number }) => void; data: (text: string) => void; write: ReturnType<typeof vi.fn> }>);
vi.mock('node-pty', () => ({ spawn: () => {
  const proc = { exit: (_event: { exitCode: number }) => {}, data: (_text: string) => {}, write: vi.fn(), kill: vi.fn(), resize: vi.fn(),
    onExit(cb: (event: { exitCode: number }) => void) { proc.exit = cb; }, onData(cb: (text: string) => void) { proc.data = cb; } };
  processes.push(proc);
  return proc;
} }));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
import { PtyManager } from '../src/main/pty-manager';

it('a late exit from a failed start cannot erase its replacement terminal', () => {
  const manager = new PtyManager();
  const exits: string[] = [];
  const output: string[] = [];
  manager.onExit(id => exits.push(id));
  manager.onData((_id, data) => output.push(data));
  manager.spawn('retry', { cwd: '/tmp', cols: 80, rows: 24, shell: 'sh' });
  const old = processes.at(-1)!;
  manager.kill('retry');
  manager.spawn('retry', { cwd: '/tmp', cols: 80, rows: 24, shell: 'sh' });
  const replacement = manager.sessionInfo('retry');
  old.data('stale output');
  old.exit({ exitCode: 1 });
  expect(manager.sessionInfo('retry')).toBe(replacement);
  manager.write('retry', 'new input');
  expect(processes.at(-1)!.write).toHaveBeenCalledWith('new input');
  expect(exits).toEqual([]);
  expect(output).toEqual([]);
});
