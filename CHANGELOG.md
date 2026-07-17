# Changelog

All notable changes to DM Workspace. Newest version first. Always written in English.

## 0.9.20 – 2026-07-17
- fix: Creating or closing a pane now forces one final terminal fit, PTY resize and full repaint after the new layout is committed, so the existing pane no longer keeps torn or incorrectly wrapped text until it is maximized and restored
- fix: Closing a pane now asks for confirmation from every entry point (pane button, context menu, command palette and keyboard shortcut); workspace and pane close confirmations now use the Graphite Sand brand dialog with sand accents

## 0.9.19 – 2026-07-10
- fix: "Reset terminal" now also recovers a pane stuck in the alternate screen — a TUI (Claude Code, Codex) that exits uncleanly could leave the pane where the mouse wheel paged through shell history instead of scrolling the buffer, and the reset didn't help; it now leaves the alternate screen and re-shows a hidden cursor in addition to clearing mouse-tracking modes

## 0.9.18 – 2026-07-09
- fix: Copying from the terminal no longer picks up the padding spaces TUIs (Claude Code, Codex) paint around their boxes — trailing whitespace is stripped from every copied line (context menu and Cmd+C), while leading indentation is kept for code
- feat: New context-menu action "Copy as command" — collapses a command a TUI displayed across several padded lines into one clean, pasteable line

## 0.9.17 – 2026-07-09
- fix: Resizing a pane sideways no longer shreds the output of running TUIs (Claude Code, Codex) – the terminal used to reflow at every intermediate width while the program still painted at the old width, leaving torn, duplicated rows that only a maximize/restore cleaned up. Width changes now reflow once, when the drag settles, together with the program's resize signal; height-only resizes still track the drag live

## 0.9.16 – 2026-07-09
- feat: New "Graphite Sand" app design — the DM Apps corporate look with graphite surfaces, warm sand accents, the brand gradient in Settings and on the welcome screen, and the DM wordmark. It is now the default; Black Utility and Standard stay available under Settings → Appearance
- fix: The chosen app design, language and terminal-click setting now survive restarts and updates — previously they silently reset to Black Utility / system language on every launch

## 0.9.15 – 2026-07-08
- fix: Ctrl+Plus / Ctrl+Minus now zoom without needing Shift – Electron's default zoom shortcut only registered as Ctrl+Shift+Plus, so plain Ctrl+Plus did nothing (Windows/Linux)
- feat: Ctrl+mouse wheel and Ctrl+Numpad +/− now zoom the UI, matching browser behavior
- fix: Dragging a pane divider or the panel edge no longer sticks to the mouse while the preview/file editor panel is open – the preview view swallowed the mouse release, so the drag could never finish

## 0.9.14 – 2026-07-08
- change: App icon mark reduced further (~60% tile fill) — macOS 26 and the Windows taskbar render the tile edge-to-edge, so the previous size still crowded the edge (per DM BrandDesign v1.0.2)

## 0.9.13 – 2026-07-07
- change: App icon refined — the tile mark is slightly smaller so it no longer crowds the squircle edge (all platforms, per DM BrandDesign v1.0.1)

## 0.9.12 – 2026-07-07
- change: New app icon in the DM "Graphite Sand" brand design — the familiar tile layout with squarer corners in the warm base-metal gradient (all platforms)

## 0.9.11 – 2026-07-05
- perf: Terminal output is now batched into far fewer internal messages, so heavy output (build logs, streaming AI agents) no longer floods the app and stays smooth instead of stuttering
- perf: Dragging a pane divider now sends the shell a single resize once the drag settles instead of a rapid-fire storm, so full-screen programs (vim, streaming agents) no longer re-render dozens of times per drag – the visible terminal still reflows live
- perf: Terminals in hidden workspaces now save their scrollback on a much slower cadence (with one immediate save when you switch away), cutting constant background CPU usage while agents keep producing output
- change: The terminal scrollback limit (1000 lines) is now set explicitly instead of relying on the built-in default

## 0.9.10 – 2026-07-02
- fix: The file browser now works on Windows – breadcrumbs split `C:\…` paths into clickable segments, and the "up" button stops at the drive root instead of jumping to a broken `/` (Windows)
- fix: Ctrl+V reaches the shell again on macOS (readline quoted-insert, vim's visual block) instead of being swallowed by the paste handler – pasting stays on Cmd+V (macOS)
- fix: Ctrl+R reaches the shell's history search again in packaged builds – the hidden Reload/DevTools menu shortcuts are now dev-only, so an accidental Ctrl+R can no longer reset all terminals (Windows/Linux)
- fix: App state, terminal scrollback and TASKS.md are now written atomically, so a crash or forced quit mid-write can no longer corrupt them and silently reset all workspaces
- fix: Custom pane titles and pending startup commands now survive changing a workspace's base folder
- fix: Keyboard focus now follows the action – to the split neighbor after closing a pane, to the new pane after a split, to the first pane after switching workspaces, and back to the terminal after closing search – instead of keystrokes going nowhere until a click
- fix: App shortcuts are suspended while a dialog is open, so Cmd/Ctrl+W can no longer close a pane behind a delete confirmation
- fix: Cmd/Ctrl+S only saves the file editor while it is visible and never intercepts the keystroke inside a terminal (where Ctrl+S is flow control)
- fix: Deleting a file inside an expanded subfolder now updates the file tree immediately
- fix: "Cancel" in the workspace editor now discards colour, folder and task changes instead of silently keeping them
- fix: The update dialog shows an error instead of loading forever when the release notes can't be fetched
- fix: Moving a task into a renamed last column (e.g. "Fertig") now checks it off, not just columns named "Done"
- fix: Workspace shortcuts Cmd/Ctrl+1–9 now work on keyboard layouts where digits require Shift (e.g. AZERTY)
- fix: Dropped or pasted paths containing `$` or a backtick are now escaped correctly for PowerShell (Windows)
- fix: A custom shell now gets matching startup flags – cmd.exe no longer receives PowerShell arguments, git-bash starts as a login shell (Windows)
- security: Markdown previews no longer load remote images (tracking protection for untrusted agent output), and external links open in the system browser instead of being dead clicks
- perf: Terminal status changes no longer re-render the whole workspace navigation, and layout operations reuse unchanged subtrees

## 0.9.8 – 2026-06-30
- change: Terminal panes now have a "Reset terminal" entry in the right-click menu that unsticks the input – e.g. after a tool exits and leaves mouse tracking on, hijacking the scroll wheel and text selection – without clearing the pane's contents (use "Clear window" for that)

## 0.9.7 – 2026-06-30
- fix: Terminal panes now automatically restore GPU-accelerated rendering after a graphics context loss (e.g. the GPU going to sleep, a driver reset, or switching graphics cards), instead of staying stuck on the slower software renderer – which showed up as sluggish scrolling and a different scrollbar – until the app was restarted

## 0.9.6 – 2026-06-24
- change: The app chrome now follows the DM BrandDesign surface, accent and focus tokens for sidebar, workspace tabs, panes, dialogs and primary controls.
- change: The top-right titlebar action buttons stay neutral gray on hover and active states, while workspace selection uses a soft DM orange accent.
- change: Settings now labels the color presets as terminal themes to clarify that they style terminal panes, not the full app chrome.

## 0.9.5 – 2026-06-23
- change: The app icon now uses the colorful DM BrandDesign direction across macOS, Windows and Linux, while Windows keeps the full-bleed taskbar export.

## 0.9.4 – 2026-06-23
- fix: The Windows taskbar/Explorer icon now fills the full icon canvas and ships every size (16–256px) as its own crisp frame, so it no longer looks small, cropped or pixellated (Windows)

## 0.9.3 – 2026-06-22
- change: The app icon now uses the modern DM Workspace brand mark across macOS, Windows and Linux

## 0.9.2 – 2026-06-15
- fix: Workspace renames are now persisted in order, preventing an older in-flight save from restoring the previous name on Windows

## 0.9.1 – 2026-06-14
- fix: The "What's new" window is now always shown in English – including its title, badges and entries – regardless of the selected UI language, since the changelog mirrors CHANGELOG.md

## 0.9.0 – 2026-06-14
- feat: The entire app interface is now available in English and German; the language can be switched in Settings (under "Appearance") – the default is English, the system language is detected on first launch, and the choice is remembered
- feat: All labels, menus, dialogs, tooltips and placeholders are translated – including Settings, the workspace editor, command palette, welcome screen, file browser, template wizard, task board and terminal context menu

## 0.8.1 – 2026-06-14
- feat: A new "up" button in the file browser jumps one folder level higher
- feat: Files and folders can now be deleted via right-click – they move to the trash (recoverable), with a confirmation prompt first
- feat: The workspace editor (name, color, base folder, tasks) now opens as a centered window instead of in the cramped sidebar panel; a double-click or the pencil icon opens it, Escape/clicking outside closes it
- fix: When switching to another workspace, the file browser now shows the active workspace's folder instead of staying on the previous workspace's path
- refactor: Replaced emoji symbols with consistent, flat SVG icons (matching the rest of the look)

## 0.8.0 – 2026-06-14
- feat: New file browser as a tab in the right panel – navigate the folder structure and view files, with file-type icons and a clickable path bar
- feat: Text files can be edited and saved directly in the panel (Save button or Cmd/Ctrl+S); the "+" button creates new files
- feat: Right-clicking a Markdown file offers "Preview" (rendered) and "Edit"; dragging a file from the browser into the terminal inserts its path
- fix: The right panel's background now matches the left sidebar exactly

## 0.7.18 – 2026-06-14
- fix: The "What's new" window is now genuinely as wide as the Settings menu – the previous attempt did not take effect technically
- fix: Fixed a brief "unexpectedly terminated" error right after an update – terminals are now shut down cleanly before the app closes during installation

## 0.7.17 – 2026-06-13
- perf: Inactive workspaces now release their graphics memory (WebGL) again – significantly less RAM and GPU usage with many workspaces. The terminal contents are preserved, and switching back brings the terminal up instantly

## 0.7.16 – 2026-06-13
- fix: The "What's new" and update windows are now a bit wider (as wide as the Settings menu) so the text no longer looks cramped

## 0.7.15 – 2026-06-13
- feat: Dragging a file over the terminal now shows a sleek drop area – the background blurs and a hint indicates that the path will be inserted
- feat: Clicking the version number at the bottom left opens a "What's new" window with the latest changes
- feat: When an update is available, a dialog shows the new features and asks for confirmation before installing

## 0.7.14 – 2026-06-11
- feat: Images can now be reliably pasted into the terminal via Ctrl+V / Cmd+V – cross-platform and independent of the tool (Claude, Codex, opencode …)
- feat: Dragging files from the file explorer into the terminal inserts their path
- fix: The target selection when running a task is now clearly labeled "Terminal top/bottom/left/right" instead of a cryptic abbreviation
- fix: The target-terminal selection menu is no longer cut off

## 0.7.13 – 2026-06-11
- fix: When dragging the divider (height change only), the terminal now adjusts correctly again

## 0.7.12 – 2026-06-10
- fix: No more glaring native scrollbars on macOS when "Always show scrollbars" is enabled

## 0.7.11 – 2026-06-09
- feat: Terminal transparency set to 0.95 by default for better contrast
- fix: Slim macOS-style scrollbar without a stripe on the right edge
- fix: The scrollbar handle stays hidden until you hover over it

## 0.7.10 – 2026-06-08
- feat: Automatic update check every 60 minutes with a clearly visible notice in the top right
- fix: Removed the black bar at the bottom of every pane
- perf: Enabled WebGL renderer – smoother scrolling and typing
