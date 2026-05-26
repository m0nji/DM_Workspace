import { describe, it, expect } from 'vitest';
import { createIdGenerator } from '../src/shared/ids';

describe('createIdGenerator', () => {
  it('produces sequential prefixed ids', () => {
    const next = createIdGenerator('p');
    expect(next()).toBe('p1');
    expect(next()).toBe('p2');
  });

  it('seed() advances past existing ids so it never collides after restore', () => {
    const next = createIdGenerator('p');
    // Simulate a layout loaded from disk that already used p1..p3.
    next.seed(['p1', 'p2', 'p3']);
    expect(next()).toBe('p4');
  });

  it('seed() ignores ids of other prefixes and malformed suffixes', () => {
    const next = createIdGenerator('p');
    next.seed(['s5', 'w9', 'pX', 'p2']);
    expect(next()).toBe('p3');
  });

  it('seed() with no matching ids leaves the counter unchanged', () => {
    const next = createIdGenerator('p');
    next.seed(['s1', 's2']);
    expect(next()).toBe('p1');
  });

  it('seed() never moves the counter backwards', () => {
    const next = createIdGenerator('p');
    next(); next(); next(); // now at p3
    next.seed(['p1']);
    expect(next()).toBe('p4');
  });
});
