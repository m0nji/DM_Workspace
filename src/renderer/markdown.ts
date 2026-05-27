import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Render untrusted markdown (e.g. agent output) to sanitized HTML.
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}
