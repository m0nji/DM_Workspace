// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/renderer/markdown';

describe('renderMarkdown', () => {
  it('renders a heading to an <h1>', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>');
  });

  it('renders bold and lists', () => {
    const html = renderMarkdown('**bold**\n\n- a\n- b');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<li>a</li>');
  });

  it('strips a script tag (XSS protection)', () => {
    const html = renderMarkdown('ok <script>alert(1)</script> done');
    expect(html).not.toContain('<script>');
    expect(html).toContain('ok');
  });
});
