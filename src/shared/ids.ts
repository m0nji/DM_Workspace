export interface IdGenerator {
  (): string;
  // Advance the counter past any already-used ids (e.g. a layout loaded from
  // disk) so freshly generated ids can't collide with restored ones.
  seed(existing: Iterable<string>): void;
}

export function createIdGenerator(prefix: string): IdGenerator {
  let n = 0;
  const gen = (() => `${prefix}${++n}`) as IdGenerator;
  gen.seed = (existing: Iterable<string>) => {
    for (const id of existing) {
      if (!id.startsWith(prefix)) continue;
      const num = Number(id.slice(prefix.length));
      if (Number.isInteger(num) && num > n) n = num;
    }
  };
  return gen;
}
