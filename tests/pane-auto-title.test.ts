import { describe, expect, it } from 'vitest';
import {
  commandTitle, createPaneAutoTitleTracker, detectAgentCommand, promptTitle
} from '../src/shared/pane-auto-title';

function harness() {
  const titles: string[] = [];
  const tracker = createPaneAutoTitleTracker({ onTitle: (title) => titles.push(title) });
  return { tracker, titles, current: () => titles.at(-1) ?? '' };
}

describe('pane automatic title tracker', () => {
  it('uses a submitted shell command as the active title', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('ssh root@10.0.0.8\r');
    expect(h.current()).toBe('ssh root@10.0.0.8');
  });

  it('clears the active title when the local shell prompt returns', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('sleep 1\r');
    h.tracker.onShellPrompt();
    expect(h.current()).toBe('');
  });

  it('never turns input to a running non-agent command into a title', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('ssh root@server\r');
    h.tracker.onInput('super-secret-password\r');
    expect(h.current()).toBe('ssh root@server');
  });

  it('never captures an SSH password after rerunning the command from shell history', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('ssh root@server\r');
    h.tracker.onShellPrompt(); // disconnect: the trusted local prompt returns
    expect(h.current()).toBe('');

    // Up recalls the SSH command inside the shell's own line editor. The
    // tracker cannot know that text, but Enter must still disarm it while SSH
    // owns the terminal.
    h.tracker.onInput('\x1b[A\r');
    h.tracker.onInput('super-secret-password\r');

    expect(h.current()).toBe('');
    expect(h.titles).not.toContain('super-secret-password');
  });

  it('disarms on every submitted shell line, including an empty one', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('\r');
    h.tracker.onInput('must-not-be-a-title\r');
    expect(h.current()).toBe('');
  });

  it('queues a startup command sent before the first shell prompt', () => {
    const h = harness();
    h.tracker.onInput('npm run dev\r');
    h.tracker.onShellPrompt();
    expect(h.current()).toBe('npm run dev');
  });

  it('replaces a Claude command with a short title from the first real prompt', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('claude\r');
    expect(h.current()).toBe('claude');

    h.tracker.onInput('y\r'); // onboarding confirmation, not the prompt
    expect(h.current()).toBe('claude');

    h.tracker.onInput('Bitte analysiere den Login-Fehler und ergänze passende Regressionstests. Danach nichts deployen.\r');
    expect(h.current()).toBe('Claude · Analysiere den Login-Fehler und ergänze passende…');

    h.tracker.onInput('Dieser zweite Prompt darf den Titel nicht ersetzen\r');
    expect(h.current()).toBe('Claude · Analysiere den Login-Fehler und ergänze passende…');
  });

  it('captures the first prompt again after Claude clears its conversation', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('claude\r');
    h.tracker.onInput('Analysiere den Login-Fehler\r');
    expect(h.current()).toBe('Claude · Analysiere den Login-Fehler');

    h.tracker.onInput('/clear\r');
    expect(h.current()).toBe('Claude');
    h.tracker.onInput('Bitte optimiere jetzt die Panel-Titel\r');
    expect(h.current()).toBe('Claude · Optimiere jetzt die Panel-Titel');
  });

  it('captures the first prompt again after Codex starts a new chat', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('codex\r');
    h.tracker.onInput('Review the release flow\r');
    expect(h.current()).toBe('Codex · Review the release flow');

    h.tracker.onInput('/new\r');
    expect(h.current()).toBe('Codex');
    h.tracker.onInput('Please fix the release notes and add tests\r');
    expect(h.current()).toBe('Codex · Fix the release notes and add tests');
  });

  it('does not treat ordinary slash commands as a session reset', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('codex\r');
    h.tracker.onInput('Review the release flow\r');
    h.tracker.onInput('/compact\r');
    h.tracker.onInput('This later prompt must not replace the title\r');
    expect(h.current()).toBe('Codex · Review the release flow');
  });

  it('handles a multi-line bracketed paste as one Codex prompt', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('codex\r');
    h.tracker.onInput('\x1b[200~Fix the release flow\nand add tests\x1b[201~\r');
    expect(h.current()).toBe('Codex · Fix the release flow and add tests');
  });

  it('discards Codex OSC colour-query replies before capturing the prompt', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('codex\r');

    // xterm answers Codex's OSC 10/11 foreground/background queries through the
    // same onData stream as keyboard input. Deliberately split the first reply
    // across events to cover the real asynchronous transport.
    h.tracker.onInput('\x1b]10;rgb:dddd/dddd');
    h.tracker.onInput('/dddd\x1b\\\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\');
    h.tracker.onInput('woran haben wir zuletzt gearbeitet?\r');

    expect(h.current()).toBe('Codex · Woran haben wir zuletzt gearbeitet?');
  });

  it('discards DCS and APC terminal replies as well', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('claude\r');
    h.tracker.onInput('\x1bP1$r0m\x1b\\\x1b_hidden terminal metadata\x1b\\');
    h.tracker.onInput('Fix the panel title\r');
    expect(h.current()).toBe('Claude · Fix the panel title');
  });

  it('tracks common line editing without leaking escape sequences', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    h.tracker.onInput('ssh root@10.0.0.9x\x7f\r');
    expect(h.current()).toBe('ssh root@10.0.0.9');
  });

  it('ignores terminal focus in/out reports (Windows ConPTY enables DECSET 1004)', () => {
    const h = harness();
    h.tracker.onShellPrompt();
    // Windows ConPTY turns on focus reporting, so xterm sends ESC[I / ESC[O
    // through the same onData stream as keystrokes on every focus change —
    // including the focus-in from clicking the pane before typing. These are
    // terminal→host status reports, not edits, and must not void the command.
    h.tracker.onInput('\x1b[I');
    h.tracker.onInput('ssh root@10.0.0.8');
    h.tracker.onInput('\x1b[O');
    h.tracker.onInput('\x1b[I');
    h.tracker.onInput('\r');
    expect(h.current()).toBe('ssh root@10.0.0.8');
  });
});

describe('pane title helpers', () => {
  it('detects direct and wrapped agent commands but not arguments to echo', () => {
    expect(detectAgentCommand('claude --dangerously-skip-permissions')).toBe('claude');
    expect(detectAgentCommand('cd repo && /opt/homebrew/bin/codex')).toBe('codex');
    expect(detectAgentCommand('npx @anthropic-ai/claude-code')).toBe('claude');
    expect(detectAgentCommand('echo claude')).toBeNull();
  });

  it('keeps quoted tokens together when picking the executable', () => {
    expect(detectAgentCommand('"/opt/my tools/claude" --help')).toBe('claude');
    expect(detectAgentCommand("'/opt/my tools/codex' run")).toBe('codex');
    expect(detectAgentCommand('echo "claude" && codex')).toBe('codex');
    // A backslash-escaped quote stays inside the token instead of ending it.
    expect(detectAgentCommand('echo "a\\"claude" ; codex')).toBe('codex');
  });

  // The tokenizer runs synchronously in the renderer on every submitted command
  // line, so a pathological input freezes the UI. The old quoted-token pattern
  // was ambiguous on a backslash (both alternatives matched it), which made an
  // unterminated quote followed by a run of backslashes take exponential time —
  // 26 of them already cost 1.4 s, and every further one doubled it.
  it('tokenizes an unterminated quote with many backslashes in linear time', () => {
    const evil = `x "${'\\'.repeat(2000)}`;
    const started = Date.now();
    expect(detectAgentCommand(evil)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('collapses whitespace and shortens command and prompt titles at word boundaries', () => {
    expect(commandTitle('  ssh   root@example.test  ')).toBe('ssh root@example.test');
    expect(promptTitle('# Fix the login bug. Then deploy it.')).toBe('Fix the login bug');
    expect(commandTitle('one two three four five', 14)).toBe('one two three…');
  });

  it('prefers an actionable sentence and removes conversational filler', () => {
    expect(promptTitle('Wir haben seit gestern ein Problem. Kannst du bitte den Login-Fehler analysieren und Regressionstests ergänzen? Danach nichts deployen.'))
      .toBe('Den Login-Fehler analysieren und Regressionstests ergänzen?');
    expect(promptTitle('I would like you to please fix the panel title and add tests.'))
      .toBe('Fix the panel title and add tests');
  });

  // A command title is not just shown in the header: when notifications are on
  // it becomes the body of an OS notification, which macOS keeps in Notification
  // Center and can show on the lock screen. Anything secret on the command line
  // must be gone before it gets that far — the prompt path already does this.
  it('redacts secrets on the command line, including env-var prefixed names', () => {
    expect(commandTitle('export GITHUB_TOKEN=ghp_realsecret && claude'))
      .toBe('export GITHUB_TOKEN=[versteckt] && claude');
    expect(commandTitle('PGPASSWORD=hunter2 psql -h db')).toBe('PGPASSWORD=[versteckt] psql -h db');
    expect(commandTitle('curl -H "Authorization: Bearer abc.def-123"'))
      .toBe('curl -H "Authorization: Bearer [versteckt]"');
    expect(commandTitle('deploy --api-key "s3cr3t value"')).toBe('deploy --api-key=[versteckt]');
  });

  it('leaves ordinary commands untouched', () => {
    expect(commandTitle('git commit -m "fix the login bug"')).toBe('git commit -m "fix the login bug"');
    expect(commandTitle('npm run build -- --watch')).toBe('npm run build -- --watch');
  });

  it('redacts common secret values before displaying a prompt title', () => {
    expect(promptTitle('Bitte prüfe token=super-secret-value und behebe den Login.'))
      .toBe('Prüfe token=[versteckt] und behebe den Login');
  });

  // Der Bearer-Zweig von redactSensitiveValues war ungetestet. Pane-Titel landen
  // in der Fensterleiste und in OS-Notifications — ein durchgereichtes Token wäre
  // dort dauerhaft sichtbar.
  it('redacts a Bearer token from a prompt title', () => {
    const out = promptTitle('Bitte prüfe Bearer eyJhbGciOi.abc-def_ghi~x+y/z= und fahre fort.');
    expect(out).not.toContain('eyJhbGciOi');
    expect(out).toContain('Bearer [versteckt]');
  });

  it('omits pasted code and compacts long paths in a title', () => {
    expect(promptTitle('Bitte behebe den Fehler in /Users/thomas/Projects/DM_Workspace/src/renderer/store.ts. ```const token = "secret";```'))
      .toBe('Behebe den Fehler in …/store.ts');
  });
});
