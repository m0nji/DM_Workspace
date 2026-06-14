import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Render untrusted markdown (e.g. agent output) to sanitized HTML.
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['button', 'embed', 'form', 'iframe', 'input', 'object', 'style'],
    FORBID_ATTR: ['style']
  });
}

// Markdown file extensions we offer a rendered preview for.
export function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(name);
}
