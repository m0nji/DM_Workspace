// Ein Renderer, der direkt nach dem Neuladen wieder abstürzt, darf keine
// Endlosschleife aus Absturz und Reload erzeugen. Der Aufrufer fragt vor jedem
// Reload; nur ein erlaubter Versuch verbraucht Budget.
export function createReloadLimiter(
  max: number,
  windowMs: number,
  now: () => number = Date.now
): () => boolean {
  const stamps: number[] = [];
  return () => {
    const t = now();
    while (stamps.length > 0 && t - stamps[0] >= windowMs) stamps.shift();
    if (stamps.length >= max) return false;
    stamps.push(t);
    return true;
  };
}
