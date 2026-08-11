# Changelog

All notable changes to DM Workspace. Newest version first. Always written in English.

## 0.13.0 – 2026-08-11
- feat: A pane's focus can now move by keyboard alone. `Mod+Shift+Left/Right/Up/Down` (Cmd on macOS, Ctrl elsewhere) moves focus to the neighboring pane in that direction, and typing continues in the new pane without needing a click first. Wrap-around is deliberately left out — pressing left at the left edge does nothing — and a maximized pane ignores the shortcut entirely, since there is nothing else on screen to move to. The four shortcuts show up in Settings → Keyboard shortcuts and in the command palette, and can be rebound like any other shortcut
- feat: Two panes can be swapped by dragging one pane's header onto another. The terminal moves with its pane — the running shell and its scrollback survive the swap rather than being closed and started fresh — so a swap is a pure rearrangement, not a restart. Only a direct swap between two panes is supported; a pane cannot be dropped into a new spot in the layout tree

## 0.12.0 – 2026-08-10
- change: A scheduled task's schedule can be adjusted after you pick it. The list offered finished templates — "Weekly, Monday 03:00" among them — and wanting anything else, a Tuesday instead of a Monday, meant falling back on "Custom cron expression" and writing `0 3 * * 2` by hand. That list is now a list of frequencies, and the fields belonging to the chosen one sit below it, filled in and editable: a weekday and a time for a weekly task, a time for a daily one, a minute for an hourly one. A new weekly task still starts at Monday 03:00; moving it to Tuesday is now a dropdown. Editing works the same way round — a task saved as `0 3 * * 2` opens as Tuesday, 03:00, rather than as an expression. A schedule that doesn't fit the pattern, one with a list or a step in it, still opens as "Custom cron expression" with its text untouched, so opening and saving a hand-written schedule cannot quietly destroy it
- feat: The working directory of a scheduled task can be picked from the project instead of typed blind. The field said "relative to the project" and left it there: nothing showed what that was relative to, or what the project contained, so a mistyped path only surfaced when the task first failed to run. A "Browse…" button beside the field now opens the project's folders, starting at whatever is currently entered, and the resolved absolute path stands underneath and follows along as you type. The field stays editable — the browser is a convenience, not a detour
- change: The person responsible for a scheduled task is chosen by name. The field asked for a user ID, the raw internal identifier of an account, which nobody knows by heart — the field was effectively unusable. It is now the project's member list. Anyone from editor upwards can be assigned, and a person already assigned stays in the list even if their role has since been lowered, so saving an unrelated change cannot silently drop the assignment. The task list shows the assigned person's name as well, where it used to print the identifier

## 0.11.2 – 2026-08-10
- fix: The update dialog covers every version between the one you run and the one on offer. It only ever showed the offered version's own changes, so skipping a release meant never reading what it brought — on 0.10.0 you were offered 0.11.1 and saw two bugfixes, with the whole of 0.11.0 silently passing by. Each version now appears as its own dated section, newest first

## 0.11.1 – 2026-08-10
- fix: Opening "New remote workspace" before signing in greeted you with an internal error message — the name of an internal method and a German sentence, in an English interface. Not being signed in yet is the normal state the first time you open that dialog, so it now says so plainly and points at the place to sign in. Genuine failures still show, without the internal wrapping around them
- fix: Dates and times in the Scheduled Tasks panel follow the language set in the app. They were taken from the operating system instead, so a German interface on an English Mac showed "8/9/2026, 11:23:31 PM" next to German labels

## 0.11.0 – 2026-08-09
- feat: Scheduled tasks bring recurring, unattended agent work to a remote project. A task such as "check dependencies every Monday at 3am" now runs an AI agent on its own schedule inside the project's container on the server — a sleeping container wakes up for the run and goes back to sleep afterwards, whether or not anyone has the project open at the time. A new "Scheduled Tasks" panel, reachable from the titlebar and the command palette, lists every task in the project for everyone who has it open: name, agent, schedule spelled out in plain language, whether it's active, paused or currently running, its next due time and how its last run went, plus a detail view with the run history and a log that fills in live while a run is in progress. Seeing all of this needs nothing beyond having the project open; starting or cancelling a run needs to be an owner or an editor; creating and changing tasks needs management permission, and a project can decide whether that means owners only or owners and editors alike; a task assigned to you can always be edited by you, even without that permission. A button you're not allowed to use stays visible rather than vanishing, and explains why on hover instead of just looking broken. None of this appears unless a workspace server is configured — most people run DM Workspace entirely on their own machine, and for them nothing changes: no button, no palette entry, no new panel
- change: A new terminal on a remote workspace can be placed where you want it. The pane header offered a single `+` that always appended the terminal to the right, so the only way to a stacked layout was to drag splitters afterwards. It now carries the same two buttons a local pane has — split left/right and split top/bottom — and the terminal the server creates lands beside or below the one you clicked, ready to type in. `Mod+D` and `Mod+Shift+D` work there too, and the command palette lists both directions; previously the shortcuts did nothing at all on a remote workspace. A terminal someone else opens still appears on the right and leaves your focus where it was

## 0.10.0 – 2026-08-09
- feat: DM Workspace can now connect to a DM Workspace Web server, so a workspace no longer has to run on the machine in front of you. Settings gained an "Account & servers" section where you add a server and sign in — either with username and password directly in the app, or by clicking "Sign in via browser", which opens your normal browser, lets you confirm the pairing there and hands the session back to the app. The session is stored encrypted on this machine through the operating system's own keystore and never leaves the app
- feat: Remote workspaces put a project's terminals on the server, shared with everyone else who has it open. Everyone sees the same output at the same time, but only one person types at a time: that person is the driver, and the others ask for write access and are handed it. A bar above each terminal shows who is connected, who is driving, and lets you request, hand over or approve write access. Because the terminals live on the server, closing the app or losing the network does not kill what is running — reconnecting picks the session back up where it was
- feat: A remote workspace's files can be browsed and edited from the app, not only its terminals. If someone else changes a file while you have it open, saving no longer silently overwrites their work: the app says the file changed on the server and offers to reload it or overwrite it deliberately
- feat: "Personal environment" is a new kind of remote workspace — your own isolated container on the server, separate from the shared projects, with its own home directory and its own `/workspace`. SSH keys, git configuration and anything you install there survive restarts. It sleeps when unused and wakes up when you connect again. System packages are installed through the server rather than in the shell, which stays without root
- feat: A remote workspace — one running on a workspace server rather than on this machine — is now marked as such wherever workspaces are listed. A server icon replaces the plain colour dot, and a second line under the name shows which server it lives on (or a note that the server was removed), so it no longer looks identical to a local one
- feat: Terminals on a remote workspace can now be created and closed from the desktop, the same way local ones always could. The `+` button opens a new terminal on the project and it appears for every connected client, including the browser; closing one removes it everywhere. With a read-only role both buttons are disabled and explain why on hover, rather than looking clickable and doing nothing
- feat: When the server refuses a remote action — most commonly because your role changed to read-only while the button still looked enabled — that refusal now shows up next to the terminal instead of vanishing into a background log only the desktop's own console could show. The notice disappears again on its own after a few seconds, so a single hiccup does not leave a permanent warning
- fix: Closing a terminal on a remote workspace always asks first, whatever you use to trigger it — the button in the pane header, the terminal's context menu, the command palette or the keyboard shortcut. The palette and the shortcut previously destroyed the terminal for every connected user on a single keystroke, with no question asked, while the very same action on a local pane did ask
- fix: The two limits the server enforces on a project's terminals are now visible before you hit them: `+` is disabled once the project has the maximum of six terminals, and the last remaining terminal cannot be closed, each saying so on hover. Both actions were silently discarded by the server before — the `+` did nothing, and closing the last terminal even asked "this removes it for everyone", accepted the confirmation and then left the terminal in place

## 0.9.41 – 2026-07-25
- fix: Terminal history survives a restart on Windows again. It was replayed correctly and then erased a fraction of a second later: PowerShell clears the entire screen when it prints its first prompt, and the replayed history was still sitting on that screen. The pane then saved the emptied terminal over the stored history, so it was lost for good — every restart, not just the second one. A pane split did the same thing, because a shell repaints the screen when its size changes. The history is now placed into the scrollback before the shell starts, out of reach of both repaints. One visible change: after a restart a pane opens on a clean prompt and the previous session is one scroll up, rather than filling the screen — on macOS as well, so both systems behave alike

## 0.9.40 – 2026-07-25
- fix: The workspace sidebar lines up with the terminal panes again and is back in the app's own colour. Version 0.9.35 turned it into a floating rounded frame with no fill: it ended up 16 pixels shorter than the panes next to it with its corners 8 pixels off, because those panes run right to the window edge and leave no matching air for a frame that floats. The missing fill also let the macOS window's translucency shine through, so the sidebar was painted in the system's neutral grey instead of the app's warm palette — on Windows the opaque window hid that, which is why it only showed on the Mac. The sidebar is now one filled surface over the full window height. The settings panes keep their rounded frame; they sit inside a dialog that gives them the backdrop and the spacing the sidebar never had

## 0.9.39 – 2026-07-25
- fix: On Windows a save no longer gets lost when another program briefly holds the file. Windows refuses to replace a file while something else has it open, and that happens routinely there — the virus scanner inspects every freshly written file, so a save could collide with the scan of the one before it. The app now waits a moment and tries again instead of dropping the write; previously a pane's terminal history could quietly fail to be stored and the next launch would bring back an older state
- change: Every message the window sends to the app's core is now checked for where it came from. Only the app's own window is meant to reach file and terminal operations, and only it can — but nothing verified that, so a later change could have opened the door without anyone noticing. The rule is now enforced rather than assumed
- change: The image library used to generate the app icons was updated to a release without known vulnerabilities, and two build-time libraries were pinned to their patched versions. None of this ships inside the app — it is the toolchain that builds it. The icons themselves are unchanged, pixel for pixel

## 0.9.38 – 2026-07-25
- fix: A link in terminal output can no longer point the preview at another machine. A path starting with two slashes (`//somehost/share/report.html`) names a network location, and on Windows opening one makes the system contact that host — handing it your Windows account name and password hash before anything is shown. Since terminal output can come from a build script, a log line or an agent, such targets are now refused outright, both for the preview window and for the markdown reader
- fix: A pane title can no longer be tricked into capturing what you type into another program. Panes learn the name of the running command from a private marker your local shell prints at each prompt. Any program that writes to the terminal — including the remote side of an SSH session — could print that same marker and make the next line you typed become the pane title (and, with notifications on, the text of a system notification that macOS keeps in Notification Center). The marker now carries a secret generated fresh at every app start, which terminal output cannot know
- fix: Secrets on a command line no longer end up in the pane title or in notifications. `export GITHUB_TOKEN=…`, `PGPASSWORD=… psql` or `--api-key …` now show as `[versteckt]` in the title, the same way prompts to Claude and Codex have always been treated
- fix: Saved terminal history and the app's own state file are now readable only by your account. They were written with the system default, which on a shared machine let other local accounts read whatever had scrolled through your terminals. If you would rather not keep terminal history at all, Settings › Session still has the switch
- fix: A pasted command line with an unterminated quote followed by many backslashes no longer freezes the window. The title parser needed exponentially more time for each additional character — 26 of them already blocked the app for one and a half seconds
- change: Pages shown in the preview panel are refused every browser permission (location, notifications, clipboard reading). The app itself needs none of them, so only embedded pages could ask — and previously nothing stood in the way of them being granted

## 0.9.37 – 2026-07-25
- fix: Switching the workspace navigation between the left sidebar and the top tabs no longer kills every open pane. The panes went blank the moment the placement changed — only the splitter lines were left — and switching back did not revive them; the terminals kept running out of reach until the app was restarted. Changing the placement rebuilt the entire workspace area from scratch, and the cleanup that follows such a rebuild tore each pane's terminal out of the window again right after it had been put back in place. Both placements now build the same structure, so nothing is rebuilt and the panes simply stay; on top of that, a pane's terminal is no longer released while it is still on screen

## 0.9.36 – 2026-07-25
- feat: Restoring terminal history after a restart can now be switched off — Settings › Session › "Restore terminal history". It stays on by default, so nothing changes unless you turn it off. With it off, every launch starts with empty terminals and no terminal content is written to disk at all: the stored history is discarded the moment you flip the switch. Your workspaces, pane layout and pane titles come back either way

## 0.9.35 – 2026-07-25
- change: The sidebar and the settings panes now read as one calm surface each — a single rounded frame around plain entries, instead of a filled panel with a divider line doing the same separating job twice. The settings options sit in one continuous frame rather than a separate box per section, and the line above the sidebar footer gave way to spacing. This follows the DM Apps design rule introduced with DM Screenshot 0.9.0, so all DM apps look alike

## 0.9.34 – 2026-07-25
- fix: An unexpected error inside the app's main process no longer takes the window down with every running terminal. Such an error used to end the process immediately, so builds, agents and SSH sessions died with it and could not be recovered. The process now survives and logs the problem instead, and the values the window sends to a terminal are checked before they are used, so a malformed one is discarded rather than ending it
- fix: A failed save no longer leaves a stray `*.dmws-tmp-*` file behind — most visibly in a workspace's `.dmworkspace` folder next to TASKS.md
- change: The update component moved to a release without a known credential-leak advisory in one of its dependencies. DM Workspace never sent credentials over that path, so no published version was affected

## 0.9.33 – 2026-07-24
- fix: Automatic pane titles now work on Windows — the running shell command (an SSH session, a build) and Codex/Claude session summaries appear in the pane header just like on macOS. Windows' ConPTY enables terminal focus reporting, so every focus change (including the click into a pane before typing) sent a focus report through the same channel as your keystrokes; the title tracker took it for an unreconstructable line edit and discarded the whole command, leaving the header blank. These focus reports are now ignored

## 0.9.32 – 2026-07-23
- fix: Changing a workspace's base folder no longer breaks keyboard input — after the restart confirmation the terminal cursor stopped blinking and the Space key went dead until the window was Alt-Tabbed away and back. The confirmation was a native browser dialog, which Electron never fully recovers from; the restart question now uses the app's own dialog
- fix: After a folder change restarts a workspace's terminals, keyboard focus now lands in the first restarted terminal automatically — keystrokes used to fall nowhere until you clicked into a pane

## 0.9.31 – 2026-07-23
- fix: Terminal sessions no longer come back "unscrollable" after an app restart or update. Saving a pane's scrollback used to also record the terminal modes a running TUI (Claude Code, Codex, vim …) had active at that moment — mouse tracking and the alternate screen — and the next launch replayed them into the fresh pane, which then started with a hijacked wheel or without any scrollback at all (macOS and Windows alike, typically right after an auto-update restarted the app mid-session). Saves now persist plain content only, and old saves carrying those modes are cleaned during restore
- fix: A pane whose full-screen program crashed or was killed now heals itself — as soon as the local shell prompt returns, stale mouse tracking or a stuck alternate screen is reset automatically, without needing right-click → "Reset terminal"
- feat: Shift+mouse wheel always scrolls the terminal history, even while a full-screen program has mouse tracking enabled (matching iTerm2 / GNOME Terminal)

## 0.9.30 – 2026-07-22
- fix: Opening a pane next to a running terminal (or closing its neighbor) no longer shreds the remaining pane's text. Restructuring the layout used to rebuild the squeezed terminal from its saved scrollback — replaying old line breaks and the "session restored" separator underneath the still-running program, which then painted over the wrong rows. The terminal is now moved as-is when the layout changes, exactly like during maximize/restore; a width change reflows once and the program repaints cleanly at the new size
- change: The warm sand accent on filled buttons (update badge, "Update now", confirmation dialogs) is a touch deeper so it no longer reads as washed-out (Graphite Sand design)
- change: The destructive confirmation button ("Clear all windows") now uses a warm terracotta that fits the Graphite Sand palette instead of the utility neon red — inline error text stays red

## 0.9.29 – 2026-07-20
- fix: Commands recalled through shell history now fail closed in the automatic pane-title tracker, preventing SSH passwords or other interactive input from ever being mistaken for a new title when the recalled command cannot be reconstructed safely

## 0.9.28 – 2026-07-20
- feat: Pane headers now follow the active terminal context automatically — shell commands such as SSH connections appear while they run, and Codex or Claude sessions use a concise local summary of their first substantive prompt without sending it to another service
- feat: Automatic agent titles refresh after `/new` or `/clear`, redact common secret values and pasted code, compact long paths, and yield to an optional manual pane description; on narrow panes the folder path collapses to its final directory so the active context keeps enough room

## 0.9.27 – 2026-07-20
- feat: Terminal panes can now carry an editable workspace-local description beside their live folder path — use the new label button in each pane header to add, change, or remove a short note describing that pane's purpose

## 0.9.26 – 2026-07-19
- fix: Clicking a file link in the terminal now finds files that live in a linked git worktree — the preview only searched below the pane's folder and the workspace roots, so a path printed from a worktree checkout (e.g. `../repo-worktrees/feature/docs/x.md`) always ended in "File not found". Worktree locations are now read from git's own metadata and searched too, in both directions (main checkout ↔ worktree), including worktrees hidden under dot-folders like `.worktrees/`

## 0.9.25 – 2026-07-19
- feat: HTML files in the file browser now offer "Preview" just like markdown does, rendering the page with its CSS and scripts in the sandboxed preview webview — the same view terminal links already opened. `.markdown` and `.mdx` files preview correctly too, where the menu entry previously did nothing
- feat: Opening the file browser now jumps to the folder of the focused pane, following the shell as you cd instead of staying wherever it was last left; a folder you navigate to stays put for as long as the panel remains open
- fix: A failing file watcher no longer crashes the app — when the task board's watcher hit a runtime error (the system running out of file handles, or its folder being removed) the unhandled error took down the whole main process with an error dialog; it now quietly gives up live board reloads instead

## 0.9.23 – 2026-07-19
- fix: Updated all dependencies flagged by `npm audit` — seven advisories, three of them high severity. The only one reaching the shipped app was a DOMPurify flaw where `setConfig()` could permanently pollute the allowed-attribute list; the remaining six (vite, esbuild, undici, form-data, js-yaml, tar) affect the build toolchain only

## 0.9.22 – 2026-07-18
- feat: Workspaces can now be reordered with drag and drop in both navigation layouts — vertically in the left sidebar and horizontally in the optional top tab bar; insertion markers show the destination and the new order persists across restarts

## 0.9.21 – 2026-07-17
- fix: Edit and close icons in the top workspace navigation no longer overlap the workspace name on hover — the actions now occupy their own stable space while long names ellipsize cleanly, consistently on macOS and Windows

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
