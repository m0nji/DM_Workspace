# WebGL Terminal Unmount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce RAM, CPU, and GPU/WebGL context usage by unmounting terminal views for inactive workspaces without losing output, scrollback, live cwd, pane status, startup commands, search behavior, or workspace switch usability.

**Architecture:** Keep PTYs alive in the main process. Move the inactive-terminal state that currently lives only inside `TerminalView` into main-process helpers before any renderer unmount is enabled. Renderer terminals become attachable views over a main-side per-pane snapshot instead of the only owner of terminal state.

**Tech Stack:** Electron main/preload IPC, React, Zustand, `node-pty`, `@xterm/xterm`, `@xterm/addon-webgl`, `@xterm/addon-serialize`, Vitest, Playwright Electron e2e.

---

## Current Risk

`WorkspaceView` currently keeps every workspace mounted and hides inactive workspaces with `display: none`. That intentionally preserves each `TerminalView`, including its xterm buffer, WebGL addon, live cwd OSC parser, activity detector, scrollback serialization, and pane registry entries.

Unmounting inactive workspaces directly would dispose `TerminalView`, `WebglAddon`, and `Terminal`. The PTY can keep running, but output produced while unmounted would currently have no xterm buffer to write into, no renderer-side activity detector, no renderer-side OSC cwd parser, and no SerializeAddon saving scrollback. That is why the optimization must be staged.

## Desired Runtime Model

1. Main process owns live PTY output history per pane as a bounded raw ring buffer.
2. Main process also tracks minimal per-pane metadata derived from PTY output: live cwd, exited state, and activity status.
3. Renderer `TerminalView` can mount, request a pane snapshot, replay it into xterm, attach to live `pty:data`, and dispose safely later.
4. Inactive workspace views can be unmounted only after snapshot and metadata paths are covered by tests.
5. Keep the active workspace mounted. Optionally keep the most recently active workspace mounted as a small LRU cache if switch latency is noticeable.

## Implementation Tasks

- [ ] Add a main-process pane output buffer.
  - Create `src/main/pty-buffer.ts`.
  - Store per-pane raw PTY data chunks with bounded total bytes, for example 1-4 MB per pane or a configurable constant.
  - API: `append(paneId, data)`, `snapshot(paneId)`, `clear(paneId)`, `prune(livePaneIds)`.
  - Unit tests in `tests/pty-buffer.test.ts` must cover chunk ordering, byte cap trimming, clear, and prune.
  - Verify: `npm test -- tests/pty-buffer.test.ts`.

- [ ] Wire the buffer into PTY data before any renderer delivery.
  - In `src/main/ipc.ts`, append each `pty.onData` chunk to the new buffer before `webContents.send('pty:data', payload)`.
  - Add an IPC handler such as `pty:snapshot` returning `{ data: string; exited?: number | null; cwd?: string | null; status?: PaneStatus }`.
  - Extend `src/shared/types.ts` and `src/preload/index.ts` with a typed `getPtySnapshot(paneId)` API.
  - Keep existing `scrollback:get` unchanged for restart restore until the replacement is proven.
  - Verify: `npm run typecheck`.

- [ ] Move live cwd parsing to a shared/main-safe stream parser.
  - Today `TerminalView` registers xterm OSC handlers and calls `setPaneCwd`.
  - Add a small parser that can consume raw PTY chunks and detect OSC 7 and OSC 9;9 sequences across chunk boundaries.
  - Reuse `parseOsc7` and `parseOsc9` from `src/shared/osc-cwd.ts` for payload validation.
  - Main process stores latest cwd per pane and includes it in `pty:snapshot`.
  - Renderer still updates Zustand from snapshot and live metadata events.
  - Unit tests must cover OSC split across two chunks and invalid OSC payloads.

- [ ] Move pane activity tracking off the mounted xterm instance.
  - Current `createPaneActivity` is driven by renderer `onData` and `onInput`.
  - Either make it usable from main or add a main-side equivalent with the same state transitions.
  - Main emits typed `pane:status` events and snapshots include current status.
  - Renderer store still owns UI state, but inactive panes can receive status updates without an xterm component.
  - Tests must prove output while a workspace is inactive can still change status to `busy` and later `done`.

- [ ] Teach `TerminalView` to attach from snapshot.
  - On mount, request `getPtySnapshot(paneId)` before subscribing to live `onData`.
  - Replay snapshot data into the xterm before spawning or attaching.
  - Guard against double-spawn: `window.api.spawn` remains idempotent, but `TerminalView` should treat mount as "attach or spawn" rather than "fresh terminal".
  - Keep `SerializeAddon` save behavior initially, but ensure unmount flushes once and does not become the source of truth for inactive output.
  - Add tests or e2e coverage that output generated while unmounted appears when remounted.

- [ ] Add controlled workspace unmounting behind a setting or internal flag.
  - Change `WorkspaceView` from "all workspaces mounted, inactive display none" to:
    - Active workspace mounted.
    - Optional previous-workspace LRU mounted if needed.
    - Inactive non-cached workspaces unmounted.
  - Do not unmount within a workspace's split layout; panes inside the active workspace remain mounted to preserve split ergonomics and search/focus behavior.
  - Preserve `TaskBoard` behavior: switching between board and terminal view should not accidentally drop the active terminal unless snapshot attach is complete.

- [ ] Add e2e acceptance tests.
  - Test 1: start command in workspace A that prints after delay, switch to workspace B before output, switch back, output is visible.
  - Test 2: inactive pane emits OSC cwd update, switch back, pane title/live cwd reflects the new cwd.
  - Test 3: inactive pane reaches done status and notification/badge state still updates.
  - Test 4: after visiting several workspaces, mounted `.xterm-host` or WebGL canvas count is bounded to active workspace plus configured cache.
  - Test 5: app restart still restores scrollback for panes that were inactive before quit.

- [ ] Measure before and after.
  - Baseline: record renderer RSS, main RSS, CPU idle, and number of WebGL canvases with 1, 4, 8, and 16 workspaces/panes.
  - After buffer-only phase: verify no regression before enabling unmount.
  - After unmount phase: repeat the same measurements.
  - Capture commands and numbers in `docs/performance/webgl-unmount-results.md`.

## Non-Goals

- Do not kill PTYs for inactive workspaces.
- Do not unmount panes in the active workspace.
- Do not replace xterm rendering or WebGL for active terminals.
- Do not remove existing restart scrollback persistence until inactive live snapshots are proven reliable.

## Acceptance Criteria

- Active terminal typing, paste, drag/drop, click-to-move, links, search, clear, resize, and split behavior are unchanged.
- Switching back to an inactive workspace never shows a blank terminal while the PTY had output.
- Live cwd and pane status remain correct after inactive output.
- Renderer WebGL/canvas count is bounded by mounted workspace count.
- `npm run typecheck`, `npm test`, `npm run build`, and relevant `npm run e2e` scenarios pass or only show documented pre-existing e2e flake/failures.

## Rollback Plan

Keep the unmount behavior behind a single setting or feature flag until the e2e suite is stable. If any regression appears, disable only the `WorkspaceView` unmount switch; the main-side PTY buffer and metadata tracking can remain dormant because they do not change active terminal rendering by themselves.
