import type { Terminal } from '@xterm/xterm';

// Compare rendered text, not ANSI traffic: color/cursor-only repaints are not
// new output. Codex's empty composer may also animate a decorative star field.
// Scope that normalization to the identified empty composer so punctuation in
// commands, logs and answers remains meaningful (including dot-only output).
export function activityContent(lines: string[]): string {
  const composer = lines.findLastIndex(line => line.includes('Ask Codex to do anything'));
  const footer = lines.findIndex((line, index) => index > composer && /Context.*left/.test(line));
  return lines.map((line, index) => {
    if (composer >= 0 && footer > composer && index >= Math.max(0, composer - 1) && index < footer) {
      const normalized = line.replace(/[.·•⋅∙⋆*✦✧⠁-⣿]/g, '').trimEnd();
      // Only decoration-only rows or the known placeholder row are excluded.
      if (index === composer || !normalized.trim()) return normalized;
    }
    return line.trimEnd();
  }).join('\n');
}

export function createActivityContentObserver(term: Terminal, onContent: () => void): { output(): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let previous = '';
  let disposed = false;
  return {
    output() {
      if (disposed || timer !== null) return;
      // Fixed-window coalescing, not trailing debounce: continuous output must
      // still be sampled, and high-frequency animations must remain cheap.
      timer = setTimeout(() => {
        timer = null;
        const buffer = term.buffer.active;
        const lines: string[] = [];
        for (let row = 0; row < term.rows; row++) {
          lines.push(buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '');
        }
        const next = `${buffer.type}:${buffer.baseY}\n${activityContent(lines)}`;
        if (next !== previous) { previous = next; onContent(); }
      }, 100);
    },
    dispose() { disposed = true; if (timer !== null) clearTimeout(timer); }
  };
}
