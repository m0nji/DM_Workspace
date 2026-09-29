// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { isDialogEnter } from '../src/renderer/dialog-keys';

function keydown(target: Element, init: KeyboardEventInit): KeyboardEvent {
  let seen!: KeyboardEvent;
  const on = (e: Event) => { seen = e as KeyboardEvent; };
  window.addEventListener('keydown', on, { once: true });
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  return seen;
}

function add<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el;
}

afterEach(() => { document.body.replaceChildren(); });

describe('isDialogEnter', () => {
  it('is true for Enter in a text input — that is the dialog commit', () => {
    expect(isDialogEnter(keydown(add('input'), { key: 'Enter' }))).toBe(true);
  });

  it('is true for Enter on the body (focus fell out of the dialog)', () => {
    expect(isDialogEnter(keydown(document.body, { key: 'Enter' }))).toBe(true);
  });

  // Enter auf "Abbrechen"/"Später" muss den Button auslösen, nicht den Dialog bestätigen.
  it('is false for Enter on a button, link, select or textarea', () => {
    for (const tag of ['button', 'select', 'textarea'] as const) {
      expect(isDialogEnter(keydown(add(tag), { key: 'Enter' })), tag).toBe(false);
    }
    const a = add('a'); a.setAttribute('href', '#x');
    expect(isDialogEnter(keydown(a, { key: 'Enter' }))).toBe(false);
  });

  it('is false while an IME composition is being confirmed', () => {
    expect(isDialogEnter(keydown(add('input'), { key: 'Enter', isComposing: true }))).toBe(false);
  });

  it('is false for other keys', () => {
    expect(isDialogEnter(keydown(add('input'), { key: 'a' }))).toBe(false);
  });
});
