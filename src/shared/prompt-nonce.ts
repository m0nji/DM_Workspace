// How the per-launch prompt nonce reaches the renderer (see main/prompt-nonce.ts
// for what it is and why). It travels as a launch argument, so the parsing side
// must stay free of node imports: the preload that reads it runs sandboxed.
export const PROMPT_NONCE_FLAG = '--dmws-prompt-nonce=';

// Returns '' when the flag is absent — callers must then trust no prompt marker
// at all, rather than fall back to an unauthenticated one.
export function promptNonceFromArgv(argv: readonly string[]): string {
  const arg = argv.find((a) => a.startsWith(PROMPT_NONCE_FLAG));
  return arg ? arg.slice(PROMPT_NONCE_FLAG.length) : '';
}
