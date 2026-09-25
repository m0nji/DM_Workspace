import React from 'react';
import type { AgentIcon, AgentLogoId } from '../../shared/agent-profiles';
import { AGENT_LOGO_PATHS } from './agent-logo-paths';

// Only Claude has a colour that reads on dark and light chrome; the others
// follow the text colour like the rest of the pane header.
const BRAND_COLOR: Partial<Record<AgentLogoId, string>> = { claude: '#D97757' };

export function readableOn(hex: string): '#111111' | '#ffffff' {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#111111' : '#ffffff';
}

export function AgentLogo({ icon, name, size = 14, decorative = false }: { icon: AgentIcon; name: string; size?: number; decorative?: boolean }): React.JSX.Element {
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name };
  if (icon.kind === 'letter') {
    return <span className="agent-logo agent-logo-letter" {...a11y} title={decorative ? undefined : name}
      style={{ width: size, height: size, background: icon.color, color: readableOn(icon.color), fontSize: Math.round(size * 0.72) }}>{icon.letter}</span>;
  }
  const color = BRAND_COLOR[icon.logo];
  return <svg className={`agent-logo agent-logo-${icon.logo}`} {...a11y} width={size} height={size} viewBox="0 0 24 24"
    fill="currentColor" fillRule="evenodd" style={color ? { color } : undefined}>
    {!decorative && <title>{name}</title>}
    <path d={AGENT_LOGO_PATHS[icon.logo]} />
  </svg>;
}
