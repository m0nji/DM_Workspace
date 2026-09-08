<p align="center">
  <img src="build/icon.png" alt="DM Workspace" width="120" />
</p>

<h1 align="center">DM Workspace</h1>

<p align="center">
  A cross-platform tiling terminal app that puts several real shells side by side,
  organized into named workspaces.
</p>

<p align="center">
  <img src="assets/demo.gif" alt="Opening a 2×2 workspace and running commands in each pane" width="820" />
</p>

---

> **Just want to install it?** Grab the ready-made app package for your operating system from the [Releases page](https://github.com/m0nji/DM_Workspace/releases) — no build step required.

## What it is

DM Workspace lets you open many terminals at once in a single, tidy window. Instead of
juggling tabs, you pick a layout and get a grid of **real system shells** — zsh on macOS,
PowerShell on Windows — each one a fully working terminal. Group them into **workspaces**
you can name and switch between. Layouts and terminal history can be restored after
a restart; local programs stop when the app closes and are not resumed automatically.

It's built for anyone who runs several things in parallel: a dev server here, a build
watcher there, logs in a third pane, and a free shell in a fourth.

## How you use it

1. **Create a workspace** from the sidebar and choose where its terminals should start.
2. **Pick a layout** on the welcome screen — a single pane, two side by side, two stacked,
   four in a 2×2 grid, or eight in a 2×4 grid.
3. **Work in every pane** — each is a live shell, so run a command (or two) in each: start a
   server in one, watch tests in another, check `git` status in a third, and so on.

The animation above shows a fresh **2×2** workspace where a command is run in each of the
four panes.

## Features

- **Workspaces** — keep multiple named workspaces in the sidebar; switch, rename and delete
  them. Each one keeps its terminals running in the background while you're away.
- **Layouts at a glance** — start a workspace with 1, 2 (side by side), 2 (stacked),
  4 (2×2) or 8 (2×4) panes.
- **Real tiling terminals** — every pane is a genuine system shell. Split any pane
  left/right or top/bottom, drag the dividers to resize, maximize and restore, or close it —
  with the mouse or configurable keyboard shortcuts. Layout choices also support the keyboard.
- **Per-workspace starting folder** — choose the directory new terminals open in.
- **Your own look** — choose a theme, background and opacity, and adjust the terminal
  font size from 10–32 px in Settings → Appearance. Font changes apply immediately
  without restarting running shells.
- **Restore with clear context** — workspaces, names, layouts, pane sizes and settings
  return when you reopen the app. Optional terminal history returns alongside a visible
  reminder that local shells are new. Remote workspaces reconnect to their server sessions.
- **Recover from terminal errors** — a failed start shows details and a retry button.
  A closed local shell can be started again; template commands are consumed only after
  the terminal backend accepts the start.
- **Output activity** — optional indicators and desktop notifications tell you when
  terminal output pauses. A pause does not mean a task has finished or succeeded.
- **Workspaces at scale** — organise workspaces into groups and use the command palette
  to find actions, workspaces and saved launch templates.
- **Files, preview and tasks** — browse and edit text files, preview content and keep a
  task board beside your terminals. Connected workspace servers also support shared
  terminals and scheduled agent tasks when the server provides these features.
- **Safer keyboard confirmation** — destructive confirmations start on Cancel; Tab stays
  within the dialog and Enter activates the focused button.
- **Stays up to date** — checks for new versions on startup and updates itself in one click.

## Platforms

Available for **macOS** and **Windows**.

## Agent mode: Claude Code, Codex and OpenCode

Click **Agent** in a pane header, choose **Claude Code**, **Codex** or **OpenCode**,
then click **Start agent**. DM Workspace checks the CLI (and Node.js for Codex)
and starts it at the current pane's shell prompt, keeping its directory and
layout. An unfinished input line is cleared before launch; a running program
must be exited first. Failed checks stay in the dialog with a repair hint.
Start requests are never replayed after restarting the app. Connected sessions
show their current status and **Go to terminal** instead of another start form.

The direct start requires a detected shell prompt. It supports macOS and Linux
with zsh/bash, and Windows with
PowerShell (PowerShell 7 when installed, otherwise Windows PowerShell).
**Show start command (manual)** remains available for setting up an existing,
idle pane. Claude status requires a current Claude Code installation supporting
HTTP hooks and `PostToolBatch` (verified with 2.1.251).

**OpenCode** starts its normal [CLI interface](https://opencode.ai/docs/cli/).
Its live status adapter is not implemented yet, so its badge and overview entry
show **No live status**. No working/completed status is inferred from terminal output.

The badge distinguishes **Waiting for status** (CLI started, no report yet),
confirmed work events, **Interrupted**, **Status paused**, **Session ending** and
**Session ended**. OpenCode explicitly shows **No live status**. A successful
launch alone does not establish a working status connection. Ended and paused
sessions are excluded from the active overview and its attention count.

Choose **Pause status reporting** to hide a session from the overview while the
CLI and receipt of its status events continue. **Reconnect** restores the same
session and its latest observed state, without restarting the CLI. This applies
to sessions set up by DM Workspace; arbitrary pre-existing or resumed CLIs cannot
be attached retroactively. The registration lasts until the terminal or app ends.

**End agent session** is a separate confirmed action. It immediately terminates
the local shell and the agent process tree, then starts a fresh shell in the
current directory. The pane, layout and scrollback are preserved; shell variables,
background programs and unsaved in-memory work are not. Cancel is focused first.
A failed termination shows an error. Remote sessions are not controlled by this
local action. On POSIX, descendant processes are identified from an OS process
snapshot; already reparented/detached work is outside that tree. Windows uses
`taskkill /T /F` on the owned shell process.

The badge shows the last explicit event: **Working**, **Needs input**, **Response
ended**, **Error**, or **Unknown**. Output silence never completes an agent turn.
“Response ended” means the agent finished responding, not that its changes passed
verification. Missing or policy-blocked hooks leave the badge at **Waiting for status** before
the first report, or at its last reported state afterwards; hover to see the
report time.

This first integration supports new local sessions from their first submitted
prompt. Existing, remote and `/resume` sessions are not supported yet. The
configuration is temporary and bound to the terminal that created it; obtain a
new command after restarting the terminal or the app. No automatic permissions
or task actions are performed by the status integration.

For **Codex**, install a current CLI supporting command hooks (configuration checked
with 0.153.4) and Node.js in PATH. The generated command adds temporary hooks using
`-c`; it does not edit your config. Review and trust the DM Workspace commands in
Codex with `/hooks`, then submit your first prompt. Repeat this after generating
a new setup. See the [official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks).
The local helper forwards only lifecycle identifiers, never prompts, tool inputs
or responses. It returns no approval decisions or model context.

Codex does not provide a general failure hook, so it does not report **Error**.
Its permission hook runs before the approval decision, which may be automatic.
It therefore shows **Unknown**, not **Needs input**; the next explicit work event
restores **Working**. User-question tools are
not consistently covered by hooks. Interruptions return to **Unknown**; late events
from older turns cannot finish a newer turn. End an active agent session before
switching providers in the same pane.

Open **Agent overview** in the top-right toolbar to see connected agents across
all workspaces. Waiting agents and errors appear first; the badge counts those
needing attention. Select a row to reveal and focus its terminal. The list
updates live, includes the last report time, and removes closed panes.
