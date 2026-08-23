// PSReadLine 2.0.0 — the build Windows PowerShell 5.1 bundles — recomputes the
// column its input starts at as `_initialX % BufferWidth` on every console
// resize. That modulo is only ever correct while the prompt fits: once the PTY
// has been narrower than the prompt is long, the column is wrong for good
// (66 % 60 == 6, and widening back only recomputes 6 % 126 == 6), so the typed
// line is drawn *into* the prompt instead of behind it. Nothing the shell does
// on its own repairs it; only `InvokePrompt()` does, because it rewrites the
// prompt and re-reads the column from Console.CursorLeft.
//
// There is no way to call that from outside the shell, so the PowerShell
// bootstrap binds it to a key (see `psCwdBootstrap`) and we press that key for
// the user after a widening resize. F24 is the key because it exists in
// ConsoleKey but on no keyboard we ship for, so the binding can never collide
// with something the user actually types.
export const PSREADLINE_HEAL_CHORD = 'F24';

const VK_F24 = 135;

// What has to be written into the PTY for PSReadLine to see that key.
//
// ConPTY's VT input parser knows no escape sequence for F13..F24 — its generic
// keypad map stops at F12 — so the only way in is win32 input mode:
// `CSI Vk ; Sc ; Uc ; Kd ; Cs ; Rc _`, which conhost turns straight into
// INPUT_RECORDs. One record for the press, one for the release, exactly as
// Windows Terminal sends them. Verified against powershell.exe 5.1 through
// node-pty: the bound handler ran and the prompt was redrawn.
//
// Only ever write this to a Windows PowerShell pane. Conhost parses PTY input
// as VT and drops a CSI it does not implement, but a POSIX pty has no such
// parser at all — the bytes reach the line discipline as if they had been
// typed, and readline would put the digits into the user's command line.
export const PSREADLINE_HEAL_SEQUENCE =
  `\x1b[${VK_F24};0;0;1;0;1_\x1b[${VK_F24};0;0;0;0;1_`;
