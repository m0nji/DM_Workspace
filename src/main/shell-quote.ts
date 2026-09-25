export type ShellKind = 'posix' | 'powershell';

export function shellKind(shell: string): ShellKind | null {
  if (/(?:^|[/\\])(?:powershell|pwsh)(?:\.exe)?$/i.test(shell)) return 'powershell';
  if (/(?:^|[/\\])(?:bash|zsh|sh)(?:\.exe)?$/i.test(shell)) return 'posix';
  return null;
}

export function quotePosix(s: string): string { return `'${s.replace(/'/g, `'\\''`)}'`; }
// PowerShell also ends a single-quoted string at the typographic quotes
// U+2018-U+201B; doubling escapes each of them just like '.
export function quotePowerShell(s: string): string { return `'${s.replace(/['\u2018-\u201B]/g, '$&$&')}'`; }

// Windows CRT argv rules: backslashes only escape before a quote or the
// closing quote. Used after PowerShell's --% stop-parsing token.
export function quoteWindowsNative(s: string): string {
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

// Leading ~ is deliberately not bare: the shell would expand it.
export function posixWord(s: string): string { return /^[A-Za-z0-9_\-.,:/=@+]+$/.test(s) ? s : quotePosix(s); }
export function powerShellWord(s: string): string { return /^[A-Za-z0-9_\-.]+$/.test(s) ? s : quotePowerShell(s); }

// Resolve the Application (.exe/.cmd), never an npm .ps1 shim: execution
// policy can block .ps1, and the shim re-parses arguments. Use with `& `.
export function powerShellApplication(program: string): string {
  return `(Get-Command ${powerShellWord(program)} -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source`;
}
