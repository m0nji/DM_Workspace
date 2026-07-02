import type React from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Post-sanitize hardening for untrusted markdown in an Electron renderer:
//  - <img>: only inline data: images may load. A remote src would fire a network
//    request on render (tracking / IP leak from agent output); file/relative
//    sources resolve against the app bundle and are broken anyway.
//  - <a>: neutralize the default navigation target; clicks are handled by
//    handleMarkdownLinkClick, which routes http(s) to the system browser.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IMG' && !/^data:image\//i.test(node.getAttribute('src') ?? '')) {
    node.removeAttribute('src');
    node.removeAttribute('srcset');
  }
  if (node.tagName === 'A') node.setAttribute('rel', 'noopener noreferrer');
});

// Render untrusted markdown (e.g. agent output) to sanitized HTML.
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['button', 'embed', 'form', 'iframe', 'input', 'object', 'style'],
    FORBID_ATTR: ['style']
  });
}

// Click delegate for containers that render sanitized markdown. The main
// process blocks in-window navigation as a safety net, which would make link
// clicks dead — route external links to the system browser instead.
export function handleMarkdownLinkClick(e: React.MouseEvent): void {
  const anchor = (e.target as HTMLElement).closest('a[href]');
  if (!anchor) return;
  e.preventDefault();
  const href = anchor.getAttribute('href') ?? '';
  if (/^https?:\/\//i.test(href)) window.api.openExternal(href);
}

// Markdown file extensions we offer a rendered preview for.
export function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(name);
}
