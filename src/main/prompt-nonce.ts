import { randomBytes } from 'node:crypto';

// One unguessable value per app launch, shared by everything that speaks the
// private prompt marker (see promptSequence in shared/pane-auto-title):
//
//   * the shell hooks the main process installs embed it in the sequence they
//     print — PowerShell via argv, bash via PROMPT_COMMAND, zsh via the
//     generated .zshrc;
//   * the renderer receives it as a launch argument and accepts a marker only
//     when it carries exactly this value.
//
// Per launch rather than per pane: the zsh startup files are written once and
// shared by every pane, and a per-pane value would buy nothing — the point is
// that terminal OUTPUT cannot reproduce it, not that panes distrust each other.
let nonce: string | null = null;

export function promptNonce(): string {
  if (nonce === null) nonce = randomBytes(16).toString('hex');
  return nonce;
}
