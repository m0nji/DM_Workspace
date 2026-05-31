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
