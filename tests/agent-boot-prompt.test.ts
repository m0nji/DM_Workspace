import { describe, expect, it } from 'vitest';
import { promptMarkerDecision } from '../src/shared/agent-boot-prompt';

// A pane spawned for an agent (menu "Open <agent> …") prints one ordinary boot
// prompt while main still checks and launches the program. Main types the
// launch line itself, so no renderer input ever marks the pane 'running'.
describe('promptMarkerDecision', () => {
  it('reports every ordinary prompt as a returned shell at the prompt', () => {
    expect(promptMarkerDecision(null)).toEqual({ reportShellReturn: true, shell: 'atPrompt' });
  });

  it('keeps a launched agent running when the boot prompt is parsed after the spawn result', () => {
    expect(promptMarkerDecision('started')).toEqual({ reportShellReturn: false, shell: 'running' });
  });

  it('leaves a failed launch at the prompt so "Try again" can start it', () => {
    expect(promptMarkerDecision('failed')).toEqual({ reportShellReturn: false, shell: 'atPrompt' });
  });

  it('shows the boot prompt while the launch is undecided; the started result marks it running later', () => {
    expect(promptMarkerDecision('pending')).toEqual({ reportShellReturn: false, shell: 'atPrompt' });
  });
});
