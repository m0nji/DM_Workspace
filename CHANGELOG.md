# Changelog

All notable changes to DM Workspace. Newest version first. Always written in English.

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
