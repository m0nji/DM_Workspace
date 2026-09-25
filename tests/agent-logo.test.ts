import { expect, it } from 'vitest';
import { AGENT_LOGO_PATHS } from '../src/renderer/components/agent-logo-paths';
import { readableOn } from '../src/renderer/components/AgentLogo';
import { AGENT_LOGO_IDS } from '../src/shared/agent-profiles';

it('has a non-empty path for every logo id', () => {
  for (const id of AGENT_LOGO_IDS) expect(AGENT_LOGO_PATHS[id]).toMatch(/^M/);
});
it('picks readable letter colours', () => {
  expect(readableOn('#ffffff')).toBe('#111111');
  expect(readableOn('#1a120b')).toBe('#ffffff');
  expect(readableOn('#c97b4a')).toBe('#111111');
});
