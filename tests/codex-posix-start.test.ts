import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codexSetup } from '../src/main/codex-status-setup';

const shells = ['/bin/bash', '/bin/zsh'].filter(existsSync);

describe.skipIf(process.platform === 'win32')('local Codex starts in real POSIX shells', () => {
  for (const shell of shells) {
    for (const supported of [true, false]) {
      for (const customProgram of [false, true]) {
        it(`${shell}: ${supported ? 'modern' : 'legacy'} CLI, ${customProgram ? 'quoted program path' : 'default program'}`, () => {
          const dir = mkdtempSync(join(tmpdir(), "dmws-local-'quoted-"));
          const log = join(dir, 'argv.json');
          const executable = join(dir, customProgram ? "my 'codex" : 'codex');
          try {
            writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--help') {
  console.log(${JSON.stringify(supported ? 'Usage: codex [--no-daemon]' : 'Usage: codex [--model MODEL]')});
  process.exit(${supported ? 0 : 64});
}
if (${!supported} && args.includes('--no-daemon')) process.exit(7);
fs.writeFileSync(process.env.ARGV_LOG, JSON.stringify({ args, cwd: process.cwd() }));
`, { mode: 0o700 });
            const extraArgs = ['--profile', 'o s', "it's", '$HOME', '`id`'];
            const hookPath = join(dir, "hook with 'quotes'.cjs");
            const setup = codexSetup(hookPath, 1234, 'test-token', false, false, undefined,
              { program: customProgram ? executable : 'codex', args: extraArgs });
            execFileSync(shell, ['-c', `codex() { exit 99; }; ${setup.command}`], {
              cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, ARGV_LOG: log }
            });
            const result = JSON.parse(readFileSync(log, 'utf8'));
            expect(result.args.slice(0, supported ? 2 : 1)).toEqual(supported ? ['--no-daemon', '-c'] : ['-c']);
            const configIndex = result.args.indexOf('-c') + 1;
            expect(result.args[configIndex]).toContain(Buffer.from(hookPath).toString('base64'));
            expect(result.args.slice(configIndex + 1)).toEqual(extraArgs);
            expect(result.args).not.toContain('--remote');
            expect(result.cwd).toBe(execFileSync('/bin/pwd', ['-P'], { cwd: dir, encoding: 'utf8' }).trim());
          } finally { rmSync(dir, { recursive: true, force: true }); }
        });
      }
    }
  }

  for (const args of [['--no-daemon'], ['--remote', 'unix://'], ['--remote=unix://']]) {
    it(`respects the profile's explicit mode: ${args.join(' ')}`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'dmws-explicit-mode-'));
      const log = join(dir, 'calls.jsonl');
      try {
        writeFileSync(join(dir, 'codex'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.ARGV_LOG, JSON.stringify(args) + '\\n');
if (args[0] === '--help') console.log('--no-daemon');
`, { mode: 0o700 });
        const setup = codexSetup('/t/h.cjs', 1, 'test-token', false, false, undefined, { args });
        execFileSync('/bin/bash', ['-c', `codex() { exit 99; }; ${setup.command}`], {
          env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, ARGV_LOG: log }
        });
        const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        expect(calls).toHaveLength(1);
        expect(calls[0][0]).toBe('-c');
        expect(calls[0].slice(2)).toEqual(args);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});
