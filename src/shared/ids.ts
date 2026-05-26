export function createIdGenerator(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}
