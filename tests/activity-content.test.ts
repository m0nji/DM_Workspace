import { describe, it, expect } from 'vitest';
import { activityContent } from '../src/renderer/terminal/activity-content';

describe('terminal activity content', () => {
  const screen = (composer: string, decoration: string) => [
    'Worked for 4m 44s', decoration, composer, 'gpt-6-astra medium · Context 100% left'
  ];
  it('ignores moving stars around the empty Codex composer', () => {
    expect(activityContent(screen('› Ask Codex to do anything   ·   .', '   .    ·')))
      .toBe(activityContent(screen('› Ask Codex to do anything .      ·', ' ·   .   ')));
  });
  // Aus einer echten Sitzung: das Sternenfeld zeichnet auch in die Spalte
  // zwischen Prompt-Zeichen und Platzhalter. Wer die Dekoration loescht statt
  // sie zu leeren, verschiebt den Text und meldet Arbeit, wo keine ist.
  it('keeps the composer stable when a star lands in the prompt gap', () => {
    expect(activityContent(screen('\u203a\u2801Ask Codex to do anything   \u2808  \u2802', '   \u2804   \u2808')))
      .toBe(activityContent(screen('\u203a Ask Codex to do anything    \u2801', ' \u2840    \u2802 ')));
  });

  it('preserves answers, progress and edits to the prompt', () => {
    const initial = screen('› Ask Codex to do anything', '');
    expect(activityContent([...initial, 'Result: 1.2'])).not.toBe(activityContent([...initial, 'Result: 12']));
    expect(activityContent(initial)).not.toBe(activityContent(screen('› Fix the bug', '')));
    expect(activityContent(['Working (1s)', ...initial])).not.toBe(activityContent(['Working (2s)', ...initial]));
  });
  it('does not suppress punctuation in ordinary terminal output', () => {
    expect(activityContent(['...'])).not.toBe(activityContent(['..']));
    expect(activityContent(['echo file.txt'])).not.toBe(activityContent(['echo filetxt']));
  });
});
