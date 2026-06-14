import React from 'react';

export const ICON_VIEWBOX = '0 0 24 24';

export type IconName =
  | 'command-palette' | 'settings' | 'preview' | 'search'
  | 'back' | 'forward' | 'reload' | 'folder' | 'close'
  | 'folder-open' | 'file-code' | 'file-text' | 'file-config'
  | 'chevron-down' | 'file-plus' | 'save';

// Every icon authored on a 24×24 canvas as stroked paths so they share weight,
// scale and optical size. Values are arrays of SVG path `d` strings.
export const ICON_PATHS: Record<IconName, string[]> = {
  'command-palette': [
    'M7 9a2 2 0 1 1 2 -2v10a2 2 0 1 1 -2 -2h10a2 2 0 1 1 -2 2v-10a2 2 0 1 1 2 2h-10'
  ],
  settings: [
    'M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z',
    'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0'
  ],
  preview: [
    'M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z',
    'M15 4v16'
  ],
  search: [
    'M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0',
    'M21 21l-6 -6'
  ],
  back: ['M15 6l-6 6l6 6'],
  forward: ['M9 6l6 6l-6 6'],
  reload: [
    'M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4',
    'M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4'
  ],
  folder: [
    'M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2'
  ],
  close: ['M18 6l-12 12', 'M6 6l12 12'],
  'folder-open': [
    'M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5a1 1 0 0 1 -.986 .836h-13a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2'
  ],
  'file-code': [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
    'M10 13l-1 2l1 2',
    'M14 13l1 2l-1 2'
  ],
  'file-text': [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
    'M9 13h6',
    'M9 17h4'
  ],
  'file-config': [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
    'M11 14a1 1 0 1 0 2 0a1 1 0 0 0 -2 0'
  ],
  'chevron-down': ['M6 9l6 6l6 -6'],
  'file-plus': [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
    'M12 11l0 6',
    'M9 14l6 0'
  ],
  save: [
    'M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2',
    'M14 4l0 4l-6 0l0 -4',
    'M8 14a2 2 0 1 0 4 0a2 2 0 0 0 -4 0'
  ]
};

export interface IconProps { name: IconName; size?: number; }

/** Renders a named icon at `size` CSS px, scaled from the shared 24×24 path canvas. */
export function Icon({ name, size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox={ICON_VIEWBOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
