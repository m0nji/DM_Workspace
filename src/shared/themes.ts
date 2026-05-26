// 16 ANSI colors in xterm order:
// black,red,green,yellow,blue,magenta,cyan,white,
// brightBlack,brightRed,brightGreen,brightYellow,brightBlue,brightMagenta,brightCyan,brightWhite
export interface TerminalTheme {
  id: string;
  name: string;
  foreground: string;
  background: string;
  cursor: string;
  ansi: string[]; // length 16
}

export const BUILTIN_THEMES: TerminalTheme[] = [
  {
    id: 'default', name: 'DM Dark',
    foreground: '#dddddd', background: '#1e1e1e', cursor: '#dddddd',
    ansi: [
      '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
      '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'
    ]
  },
  {
    id: 'void', name: 'Void',
    foreground: '#c0c0c0', background: '#000000', cursor: '#00ff9c',
    ansi: [
      '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
      '#555555', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'
    ]
  },
  {
    id: 'dracula', name: 'Dracula',
    foreground: '#f8f8f2', background: '#282a36', cursor: '#f8f8f2',
    ansi: [
      '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'
    ]
  },
  {
    id: 'tokyo-night', name: 'Neon Tokyo',
    foreground: '#a9b1d6', background: '#1a1b26', cursor: '#c0caf5',
    ansi: [
      '#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
      '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'
    ]
  },
  {
    id: 'synthwave', name: 'Synthwave',
    foreground: '#f8f8f2', background: '#262335', cursor: '#ff7edb',
    ansi: [
      '#262335', '#fe4450', '#72f1b8', '#fede5d', '#03edf9', '#ff7edb', '#03edf9', '#ffffff',
      '#495495', '#fe4450', '#72f1b8', '#fede5d', '#03edf9', '#ff7edb', '#03edf9', '#ffffff'
    ]
  },
  {
    id: 'solarized-light', name: 'Solarized Light',
    foreground: '#657b83', background: '#fdf6e3', cursor: '#657b83',
    ansi: [
      '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'
    ]
  }
];

export const DEFAULT_THEME_ID = 'default';

export function getTheme(id: string): TerminalTheme {
  return BUILTIN_THEMES.find((t) => t.id === id)
    ?? BUILTIN_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}
