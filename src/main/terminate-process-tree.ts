import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function descendantPids(output: string, root: number): number[] {
  const children = new Map<number, number[]>();
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]), parent = Number(match[2]);
    if (pid <= 1 || pid === parent) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  const seen = new Set<number>([root]);
  const result: number[] = [];
  const visit = (pid: number): void => {
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      visit(child);
      result.push(child);
    }
  };
  visit(root);
  return result;
}

// Explicit, confirmed termination of one app-owned local PTY and its children.
// Read only PID/PPID metadata; never inspect arguments, environments or other terminals.
export async function terminateProcessTree(pid: number, isCurrent: () => boolean): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new Error('Invalid terminal process');
  if (!isCurrent()) throw new Error('Terminal changed');
  if (process.platform === 'win32') {
    await exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    return;
  }
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid='], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
  if (!isCurrent()) throw new Error('Terminal changed');
  // Children first, so the shell cannot orphan the observed agent tools on exit.
  for (const target of [...descendantPids(stdout, pid), pid]) {
    if (!isCurrent()) throw new Error('Terminal changed');
    try { process.kill(target, 'SIGKILL'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
}
