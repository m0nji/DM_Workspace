import { describe, it, expect } from 'vitest';
import {
  DMWS_PROMPT_OSC, promptPayload, promptSequence, isPromptPayload
} from '../src/shared/pane-auto-title';

// The marker tells the title tracker "the LOCAL shell prompt is back, the next
// line the user types is a command worth titling". Its old payload was a fixed
// public constant, so any program that can write to the terminal — a malicious
// CLI, or the remote end of an ssh session — could print it and re-arm capture
// at will. The next line typed (a sudo password at a faked prompt) then became
// the pane title, and with notifications on the body of an OS notification.
//
// The payload now carries a per-launch nonce that only the locally installed
// shell hook knows. It is not forwarded over ssh and does not appear in the
// terminal's output stream, so an output-only attacker cannot reproduce it.
describe('prompt marker', () => {
  it('binds the payload to the nonce', () => {
    expect(promptPayload('abc123')).toBe('dmws-prompt:abc123');
    expect(promptSequence('abc123')).toBe(`\x1b]${DMWS_PROMPT_OSC};dmws-prompt:abc123\x07`);
  });

  it('accepts only the exact nonce', () => {
    expect(isPromptPayload('dmws-prompt:abc123', 'abc123')).toBe(true);
    expect(isPromptPayload('dmws-prompt:wrong', 'abc123')).toBe(false);
    expect(isPromptPayload('dmws-prompt:abc123x', 'abc123')).toBe(false);
    expect(isPromptPayload('dmws-prompt:abc123;extra', 'abc123')).toBe(false);
  });

  // The pre-nonce payload is exactly what an attacker who read the old source
  // would send, and what a stale hook from a previous version still emits.
  it('rejects the old unauthenticated payload', () => {
    expect(isPromptPayload('dmws-prompt', 'abc123')).toBe(false);
  });

  // Fail closed: without a nonce nothing can be authenticated, so nothing is
  // trusted — auto-titles stop rather than becoming forgeable again.
  it('trusts nothing when no nonce is available', () => {
    expect(isPromptPayload('dmws-prompt:abc123', '')).toBe(false);
    expect(isPromptPayload('dmws-prompt:', '')).toBe(false);
    expect(isPromptPayload('dmws-prompt', '')).toBe(false);
  });
});
