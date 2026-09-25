import { useCallback, useEffect, useReducer } from 'react';
import type { AgentProfile } from '../shared/agent-profiles';
import type { AgentCheck } from '../shared/types';

type CheckState = AgentCheck | 'checking';
// Checks start a login shell (up to 8 s). Cache per program/adapter/args for
// the app session, and debounce so typing in the editor does not fan out.
const cache = new Map<string, CheckState>();
const checkKey = (p: AgentProfile): string => [p.adapter, p.command, ...p.args].join('\u0000');

export function useAgentChecks(profiles: AgentProfile[]): { get(p: AgentProfile): CheckState | undefined; recheck(p: AgentProfile): void } {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const run = useCallback((profile: AgentProfile, fresh: boolean) => {
    const key = checkKey(profile);
    if (!fresh && cache.has(key)) return;
    cache.set(key, 'checking');
    rerender();
    void window.api.checkAgentProfile(profile)
      .catch((): AgentCheck => 'check-failed')
      .then(result => { cache.set(key, result); rerender(); });
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { for (const p of profiles) run(p, false); }, 600);
    return () => clearTimeout(timer);
  }, [profiles, run]);
  return { get: p => cache.get(checkKey(p)), recheck: p => run(p, true) };
}
