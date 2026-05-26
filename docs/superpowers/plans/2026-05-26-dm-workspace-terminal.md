# DM Workspace — Terminal-Multiplexer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform (macOS first, Windows next) Electron terminal multiplexer with a workspace sidebar, a welcome-screen layout picker, and a mouse-driven tiling grid of real shell panes (split / close / resize / maximize), based on `docs/superpowers/specs/2026-05-26-dm-workspace-terminal-design.md`.

**Architecture:** Electron with a Node main process (PTY management via `node-pty`, JSON persistence) and a React renderer (xterm.js terminals, tiling UI). A pure-logic **layout tree** (binary split tree) drives all pane add/close/resize/maximize behavior and is fully unit-tested independent of UI. IPC is a thin typed bridge via `contextBridge` (no `nodeIntegration`).

**Tech Stack:** Electron, electron-vite, React, TypeScript, xterm.js (`@xterm/xterm` + fit + webgl addons), node-pty, zustand (renderer store), Vitest (unit), Playwright (E2E), electron-builder (packaging).

---

## File Structure

```
dm-workspace/
  package.json
  tsconfig.json
  tsconfig.node.json
  electron.vite.config.ts
  vitest.config.ts
  src/
    shared/
      types.ts            # AppState, Workspace, LayoutNode, IPC payload types
      layout-tree.ts      # PURE logic: split/close/resize/maximize/presets/collectPaneIds
      ids.ts              # id generator (counter-based, injectable for tests)
    main/
      index.ts            # app lifecycle, BrowserWindow, wires IPC + persistence
      pty-manager.ts      # node-pty wrapper keyed by paneId
      persistence.ts      # load/save AppState JSON in userData
      ipc.ts              # ipcMain handlers <-> PtyManager
    preload/
      index.ts            # contextBridge: window.api
    renderer/
      index.html
      main.tsx            # React root
      App.tsx             # top-level layout (sidebar + active workspace)
      store.ts            # zustand store: AppState + actions, persistence + pty calls
      components/
        Sidebar.tsx
        WelcomeScreen.tsx
        WorkspaceView.tsx # renders layout tree or WelcomeScreen
        LayoutRenderer.tsx# recursive renderer of LayoutNode + splitters
        Splitter.tsx      # draggable divider -> setRatio
        Pane.tsx          # header (split/maximize/close) + TerminalView
        TerminalView.tsx  # xterm.js instance bound to a paneId
      styles.css
  tests/
    layout-tree.test.ts
    persistence.test.ts
    pty-manager.test.ts
  e2e/
    smoke.spec.ts
```

**Conventions used throughout this plan:**
- **All user-facing UI strings are in English** (v1). Plan prose may be German; code/UI text is English.
- Commit messages use Conventional Commits (`feat:`, `test:`, `chore:`).
- Run unit tests with `npx vitest run <file>`.
- `Direction` semantics: `'h'` = children arranged left/right (vertical divider); `'v'` = children arranged top/bottom (horizontal divider).
- `ratio` on a split = fractional size (0..1) of the **first** child.
- A workspace `layout` of `null` means "no panes" → show the WelcomeScreen.

---

## Phase 0 — Project Scaffold

### Task 0: Initialize project & tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`, `vitest.config.ts`, `src/renderer/index.html`, `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "dm-workspace",
  "version": "0.1.0",
  "description": "Cross-platform tiling terminal multiplexer",
  "main": "out/main/index.js",
  "author": "DM Workspace",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "dist:mac": "electron-vite build && electron-builder --mac",
    "dist:win": "electron-vite build && electron-builder --win",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "electron": "^30.0.0",
    "electron-builder": "^24.13.0",
    "electron-vite": "^2.1.0",
    "playwright": "^1.42.0",
    "typescript": "^5.4.0",
    "vite": "^5.1.0",
    "vitest": "^1.4.0"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-webgl": "^0.18.0",
    "@xterm/xterm": "^5.5.0",
    "node-pty": "^1.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^4.5.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": ["src", "tests", "e2e"]
}
```

- [ ] **Step 3: Create `tsconfig.node.json`** (used by electron-vite for main/preload)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "lib": ["ESNext"]
  },
  "include": ["src/main", "src/preload", "electron.vite.config.ts"]
}
```

- [ ] **Step 4: Create `electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()]
  }
});
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
```

- [ ] **Step 6: Create `src/renderer/index.html`**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;" />
    <title>DM Workspace</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `.gitignore`**

```
node_modules/
out/
dist/
.superpowers/
*.log
```

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: completes; `node-pty` compiles its native module. On macOS this requires Xcode Command Line Tools (`xcode-select --install` if it fails).

- [ ] **Step 9: Verify Vitest runs (no tests yet)**

Run: `npx vitest run`
Expected: exits 0 with "No test files found" (acceptable at this stage).

- [ ] **Step 10: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold electron-vite + react + typescript project"
```

---

## Phase 1 — Core Layout Tree (pure logic, TDD)

### Task 1: Shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write the types**

```ts
export type Direction = 'h' | 'v'; // 'h' = left/right, 'v' = top/bottom

export interface PaneNode {
  type: 'pane';
  id: string; // also the paneId
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: Direction;
  ratio: number; // 0..1 size of first child
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = PaneNode | SplitNode;

export type PresetKind = '1' | '2h' | '2v' | '4' | '8';

export interface Workspace {
  id: string;
  name: string;
  cwd: string;          // default working directory for new panes
  layout: LayoutNode | null; // null => welcome screen
}

export interface AppState {
  version: 1;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

// ---- IPC payloads ----
export interface PtySpawnRequest {
  paneId: string;
  cwd: string;
  cols: number;
  rows: number;
}
export interface PtyDataEvent {
  paneId: string;
  data: string;
}
export interface PtyInputRequest {
  paneId: string;
  data: string;
}
export interface PtyResizeRequest {
  paneId: string;
  cols: number;
  rows: number;
}
export interface PtyExitEvent {
  paneId: string;
  exitCode: number;
}

// Shape exposed on window.api by the preload script
export interface RendererApi {
  spawn(req: PtySpawnRequest): Promise<void>;
  input(req: PtyInputRequest): void;
  resize(req: PtyResizeRequest): void;
  kill(paneId: string): void;
  onData(cb: (e: PtyDataEvent) => void): () => void;
  onExit(cb: (e: PtyExitEvent) => void): () => void;
  loadState(): Promise<AppState>;
  saveState(state: AppState): Promise<void>;
  pickDirectory(): Promise<string | null>;
}

declare global {
  interface Window {
    api: RendererApi;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared types (AppState, LayoutNode, IPC payloads)"
```

### Task 2: ID generator

**Files:**
- Create: `src/shared/ids.ts`
- Test: `tests/layout-tree.test.ts` (shared test file; created here)

- [ ] **Step 1: Write the failing test**

```ts
// tests/layout-tree.test.ts
import { describe, it, expect } from 'vitest';
import { createIdGenerator } from '../src/shared/ids';

describe('createIdGenerator', () => {
  it('produces unique sequential ids with a prefix', () => {
    const next = createIdGenerator('p');
    expect(next()).toBe('p1');
    expect(next()).toBe('p2');
    expect(next()).toBe('p3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: FAIL — cannot find module `../src/shared/ids`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/ids.ts
export function createIdGenerator(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ids.ts tests/layout-tree.test.ts
git commit -m "feat: add injectable id generator"
```

### Task 3: `makePane` and `collectPaneIds`

**Files:**
- Create: `src/shared/layout-tree.ts`
- Modify: `tests/layout-tree.test.ts`

- [ ] **Step 1: Write the failing test** (append to the test file)

```ts
import { makePane, collectPaneIds } from '../src/shared/layout-tree';

describe('makePane / collectPaneIds', () => {
  it('makePane creates a pane node', () => {
    expect(makePane('a')).toEqual({ type: 'pane', id: 'a' });
  });

  it('collectPaneIds returns single id for a lone pane', () => {
    expect(collectPaneIds(makePane('a'))).toEqual(['a']);
  });

  it('collectPaneIds returns [] for null layout', () => {
    expect(collectPaneIds(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: FAIL — cannot find module `../src/shared/layout-tree`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/layout-tree.ts
import type { LayoutNode, PaneNode, SplitNode, Direction, PresetKind } from './types';

export function makePane(id: string): PaneNode {
  return { type: 'pane', id };
}

export function collectPaneIds(node: LayoutNode | null): string[] {
  if (node === null) return [];
  if (node.type === 'pane') return [node.id];
  return [...collectPaneIds(node.children[0]), ...collectPaneIds(node.children[1])];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/layout-tree.ts tests/layout-tree.test.ts
git commit -m "feat: add makePane and collectPaneIds"
```

### Task 4: `splitPane`

**Files:**
- Modify: `src/shared/layout-tree.ts`, `tests/layout-tree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { splitPane } from '../src/shared/layout-tree';

describe('splitPane', () => {
  it('replaces target pane with a split of [old, new]', () => {
    const tree = makePane('a');
    const result = splitPane(tree, 'a', 'h', 'b', 's1');
    expect(result).toEqual({
      type: 'split', id: 's1', direction: 'h', ratio: 0.5,
      children: [{ type: 'pane', id: 'a' }, { type: 'pane', id: 'b' }]
    });
  });

  it('splits a nested pane and leaves siblings untouched', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    const result = splitPane(tree, 'b', 'v', 'c', 's2');
    expect(collectPaneIds(result)).toEqual(['a', 'b', 'c']);
    // 'b' is now a vertical split with children b,c
    const right = (result as any).children[1];
    expect(right).toEqual({
      type: 'split', id: 's2', direction: 'v', ratio: 0.5,
      children: [{ type: 'pane', id: 'b' }, { type: 'pane', id: 'c' }]
    });
  });

  it('returns the tree unchanged when target pane not found', () => {
    const tree = makePane('a');
    expect(splitPane(tree, 'zzz', 'h', 'b', 's1')).toEqual(tree);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: FAIL — `splitPane` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `layout-tree.ts`)

```ts
export function splitPane(
  node: LayoutNode,
  targetPaneId: string,
  direction: Direction,
  newPaneId: string,
  newSplitId: string,
  ratio = 0.5
): LayoutNode {
  if (node.type === 'pane') {
    if (node.id !== targetPaneId) return node;
    return {
      type: 'split',
      id: newSplitId,
      direction,
      ratio,
      children: [node, makePane(newPaneId)]
    };
  }
  return {
    ...node,
    children: [
      splitPane(node.children[0], targetPaneId, direction, newPaneId, newSplitId, ratio),
      splitPane(node.children[1], targetPaneId, direction, newPaneId, newSplitId, ratio)
    ]
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/layout-tree.ts tests/layout-tree.test.ts
git commit -m "feat: add splitPane"
```

### Task 5: `closePane` (with parent collapse)

**Files:**
- Modify: `src/shared/layout-tree.ts`, `tests/layout-tree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { closePane } from '../src/shared/layout-tree';

describe('closePane', () => {
  it('returns null when the only pane is closed', () => {
    expect(closePane(makePane('a'), 'a')).toBeNull();
  });

  it('collapses parent split so sibling takes the space', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    expect(closePane(tree, 'b')).toEqual({ type: 'pane', id: 'a' });
    expect(closePane(tree, 'a')).toEqual({ type: 'pane', id: 'b' });
  });

  it('collapses correctly in a nested tree', () => {
    let tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    tree = splitPane(tree, 'b', 'v', 'c', 's2');
    // closing 'c' should collapse s2 back to pane 'b'
    const result = closePane(tree, 'c');
    expect(collectPaneIds(result!)).toEqual(['a', 'b']);
    expect((result as any).children[1]).toEqual({ type: 'pane', id: 'b' });
  });

  it('returns tree unchanged when pane not found', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    expect(closePane(tree, 'zzz')).toEqual(tree);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: FAIL — `closePane` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `layout-tree.ts`)

```ts
export function closePane(node: LayoutNode, targetPaneId: string): LayoutNode | null {
  if (node.type === 'pane') {
    return node.id === targetPaneId ? null : node;
  }
  const a = closePane(node.children[0], targetPaneId);
  const b = closePane(node.children[1], targetPaneId);
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  if (a === node.children[0] && b === node.children[1]) return node; // unchanged
  return { ...node, children: [a, b] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/layout-tree.ts tests/layout-tree.test.ts
git commit -m "feat: add closePane with parent collapse"
```

### Task 6: `setRatio`

**Files:**
- Modify: `src/shared/layout-tree.ts`, `tests/layout-tree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { setRatio } from '../src/shared/layout-tree';

describe('setRatio', () => {
  it('updates ratio of the matching split', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    const result = setRatio(tree, 's1', 0.3);
    expect((result as any).ratio).toBe(0.3);
  });

  it('clamps ratio into [0.1, 0.9]', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    expect((setRatio(tree, 's1', 0) as any).ratio).toBe(0.1);
    expect((setRatio(tree, 's1', 1) as any).ratio).toBe(0.9);
  });

  it('updates a nested split without touching others', () => {
    let tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    tree = splitPane(tree, 'b', 'v', 'c', 's2');
    const result = setRatio(tree, 's2', 0.7);
    expect((result as any).ratio).toBe(0.5); // outer s1 untouched
    expect((result as any).children[1].ratio).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: FAIL — `setRatio` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `layout-tree.ts`)

```ts
export function setRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === 'pane') return node;
  if (node.id === splitId) {
    const clamped = Math.min(0.9, Math.max(0.1, ratio));
    return { ...node, ratio: clamped };
  }
  return {
    ...node,
    children: [setRatio(node.children[0], splitId, ratio), setRatio(node.children[1], splitId, ratio)]
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/layout-tree.ts tests/layout-tree.test.ts
git commit -m "feat: add setRatio with clamping"
```

### Task 7: Preset builders

**Files:**
- Modify: `src/shared/layout-tree.ts`, `tests/layout-tree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { makePreset } from '../src/shared/layout-tree';

describe('makePreset', () => {
  it('1 => single pane', () => {
    const next = (() => { let n = 0; return () => `id${++n}`; })();
    const tree = makePreset('1', next, next);
    expect(tree.type).toBe('pane');
    expect(collectPaneIds(tree)).toHaveLength(1);
  });

  it('2h => one horizontal split, two panes', () => {
    const next = (() => { let n = 0; return () => `id${++n}`; })();
    const tree = makePreset('2h', next, next);
    expect(tree.type).toBe('split');
    expect((tree as any).direction).toBe('h');
    expect(collectPaneIds(tree)).toHaveLength(2);
  });

  it('2v => vertical split', () => {
    const next = (() => { let n = 0; return () => `id${++n}`; })();
    expect((makePreset('2v', next, next) as any).direction).toBe('v');
  });

  it('4 => four panes (2x2)', () => {
    const next = (() => { let n = 0; return () => `id${++n}`; })();
    expect(collectPaneIds(makePreset('4', next, next))).toHaveLength(4);
  });

  it('8 => eight panes (2x4)', () => {
    const next = (() => { let n = 0; return () => `id${++n}`; })();
    expect(collectPaneIds(makePreset('8', next, next))).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: FAIL — `makePreset` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `layout-tree.ts`)

```ts
function split(id: string, direction: Direction, a: LayoutNode, b: LayoutNode): SplitNode {
  return { type: 'split', id, direction, ratio: 0.5, children: [a, b] };
}

/** Build a row of `n` panes (must be a power of two) arranged left/right. */
function row(n: number, nextPaneId: () => string, nextSplitId: () => string): LayoutNode {
  if (n === 1) return makePane(nextPaneId());
  const half = n / 2;
  // build children first so pane ids increase left-to-right
  const left = row(half, nextPaneId, nextSplitId);
  const right = row(half, nextPaneId, nextSplitId);
  return split(nextSplitId(), 'h', left, right);
}

export function makePreset(
  kind: PresetKind,
  nextPaneId: () => string,
  nextSplitId: () => string
): LayoutNode {
  switch (kind) {
    case '1':
      return makePane(nextPaneId());
    case '2h':
      return split(nextSplitId(), 'h', makePane(nextPaneId()), makePane(nextPaneId()));
    case '2v':
      return split(nextSplitId(), 'v', makePane(nextPaneId()), makePane(nextPaneId()));
    case '4': {
      const top = row(2, nextPaneId, nextSplitId);
      const bottom = row(2, nextPaneId, nextSplitId);
      return split(nextSplitId(), 'v', top, bottom);
    }
    case '8': {
      const top = row(4, nextPaneId, nextSplitId);
      const bottom = row(4, nextPaneId, nextSplitId);
      return split(nextSplitId(), 'v', top, bottom);
    }
  }
}
```

> Note: `nextPaneId` and `nextSplitId` may be the same generator (ids stay unique because the counter is shared). The store will pass distinct prefixes (`p`/`s`) in production.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/layout-tree.test.ts`
Expected: PASS (all layout-tree tests green).

- [ ] **Step 5: Commit**

```bash
git add src/shared/layout-tree.ts tests/layout-tree.test.ts
git commit -m "feat: add layout presets (1/2h/2v/4/8)"
```

---

## Phase 2 — Persistence (pure logic, TDD)

### Task 8: Serialize / deserialize AppState

**Files:**
- Create: `src/main/persistence.ts`
- Test: `tests/persistence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/persistence.test.ts
import { describe, it, expect } from 'vitest';
import { serialize, deserialize, defaultState } from '../src/main/persistence';
import type { AppState } from '../src/shared/types';

describe('persistence serialize/deserialize', () => {
  const sample: AppState = {
    version: 1,
    activeWorkspaceId: 'w1',
    workspaces: [
      { id: 'w1', name: 'Workspace 1', cwd: '/home/x', layout: { type: 'pane', id: 'p1' } }
    ]
  };

  it('round-trips state through serialize/deserialize', () => {
    expect(deserialize(serialize(sample))).toEqual(sample);
  });

  it('returns defaultState for invalid JSON', () => {
    expect(deserialize('not json')).toEqual(defaultState());
  });

  it('returns defaultState when version is missing/unknown', () => {
    expect(deserialize(JSON.stringify({ workspaces: [] }))).toEqual(defaultState());
  });

  it('defaultState has one workspace with a null layout (welcome screen)', () => {
    const s = defaultState();
    expect(s.workspaces).toHaveLength(1);
    expect(s.workspaces[0].layout).toBeNull();
    expect(s.activeWorkspaceId).toBe(s.workspaces[0].id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/persistence.test.ts`
Expected: FAIL — cannot find module `../src/main/persistence`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/persistence.ts
import { homedir } from 'os';
import type { AppState } from '../shared/types';

export function defaultState(): AppState {
  return {
    version: 1,
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Workspace 1', cwd: homedir(), layout: null }]
  };
}

export function serialize(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

function isValid(obj: unknown): obj is AppState {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return s.version === 1 && Array.isArray(s.workspaces);
}

export function deserialize(json: string): AppState {
  try {
    const parsed = JSON.parse(json);
    return isValid(parsed) ? (parsed as AppState) : defaultState();
  } catch {
    return defaultState();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/persistence.ts tests/persistence.test.ts
git commit -m "feat: add AppState serialize/deserialize with validation + default"
```

### Task 9: Load / save to disk

**Files:**
- Modify: `src/main/persistence.ts`, `tests/persistence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { loadStateFromFile, saveStateToFile } from '../src/main/persistence';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('persistence file IO', () => {
  it('saves then loads identical state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dmws-'));
    const file = join(dir, 'state.json');
    const state = defaultState();
    state.workspaces[0].name = 'Renamed';
    saveStateToFile(file, state);
    expect(loadStateFromFile(file)).toEqual(state);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns defaultState when file is missing', () => {
    expect(loadStateFromFile('/nonexistent/path/state.json')).toEqual(defaultState());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/persistence.test.ts`
Expected: FAIL — `loadStateFromFile`/`saveStateToFile` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `persistence.ts`)

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

export function loadStateFromFile(file: string): AppState {
  if (!existsSync(file)) return defaultState();
  try {
    return deserialize(readFileSync(file, 'utf8'));
  } catch {
    return defaultState();
  }
}

export function saveStateToFile(file: string, state: AppState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serialize(state), 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/persistence.ts tests/persistence.test.ts
git commit -m "feat: add load/save AppState to disk"
```

---

## Phase 3 — PTY Manager & IPC (main process)

### Task 10: PtyManager

**Files:**
- Create: `src/main/pty-manager.ts`
- Test: `tests/pty-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/pty-manager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PtyManager } from '../src/main/pty-manager';

describe('PtyManager', () => {
  it('spawns a shell, streams data, and echoes typed input', async () => {
    const mgr = new PtyManager();
    const chunks: string[] = [];
    mgr.onData((paneId, data) => { if (paneId === 'p1') chunks.push(data); });

    mgr.spawn('p1', { cwd: process.cwd(), cols: 80, rows: 24 });
    // Write a command that prints a unique marker, then exits.
    mgr.write('p1', 'echo DMWS_MARKER_123\r');

    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('DMWS_MARKER_123');
    }, { timeout: 5000, interval: 100 });

    mgr.kill('p1');
  });

  it('kill removes the pane so further writes are no-ops', () => {
    const mgr = new PtyManager();
    mgr.spawn('p2', { cwd: process.cwd(), cols: 80, rows: 24 });
    mgr.kill('p2');
    expect(() => mgr.write('p2', 'x')).not.toThrow();
  });
});
```

> This is an integration test that spawns a real shell — it does not need Electron. It runs under Node via Vitest.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pty-manager.test.ts`
Expected: FAIL — cannot find module `../src/main/pty-manager`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/pty-manager.ts
import * as pty from 'node-pty';

export interface SpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  shell?: string;
}

function defaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/zsh';
}

type DataListener = (paneId: string, data: string) => void;
type ExitListener = (paneId: string, exitCode: number) => void;

export class PtyManager {
  private procs = new Map<string, pty.IPty>();
  private dataListeners: DataListener[] = [];
  private exitListeners: ExitListener[] = [];

  onData(cb: DataListener): void { this.dataListeners.push(cb); }
  onExit(cb: ExitListener): void { this.exitListeners.push(cb); }

  spawn(paneId: string, opts: SpawnOptions): void {
    if (this.procs.has(paneId)) return;
    const proc = pty.spawn(opts.shell || defaultShell(), [], {
      name: 'xterm-color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: process.env as Record<string, string>
    });
    proc.onData((data) => this.dataListeners.forEach((l) => l(paneId, data)));
    proc.onExit(({ exitCode }) => {
      this.procs.delete(paneId);
      this.exitListeners.forEach((l) => l(paneId, exitCode));
    });
    this.procs.set(paneId, proc);
  }

  write(paneId: string, data: string): void {
    this.procs.get(paneId)?.write(data);
  }

  resize(paneId: string, cols: number, rows: number): void {
    this.procs.get(paneId)?.resize(cols, rows);
  }

  kill(paneId: string): void {
    const proc = this.procs.get(paneId);
    if (proc) {
      proc.kill();
      this.procs.delete(paneId);
    }
  }

  killAll(): void {
    for (const id of [...this.procs.keys()]) this.kill(id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pty-manager.test.ts`
Expected: PASS. (If `node-pty` fails to load, rebuild it: `npm rebuild node-pty`.)

- [ ] **Step 5: Commit**

```bash
git add src/main/pty-manager.ts tests/pty-manager.test.ts
git commit -m "feat: add PtyManager wrapping node-pty"
```

### Task 11: IPC wiring + main entry + preload

**Files:**
- Create: `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`

- [ ] **Step 1: Write `src/main/ipc.ts`**

```ts
import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import { join } from 'path';
import { PtyManager } from './pty-manager';
import { loadStateFromFile, saveStateToFile } from './persistence';
import type {
  AppState, PtySpawnRequest, PtyInputRequest, PtyResizeRequest, PtyDataEvent, PtyExitEvent
} from '../shared/types';

const STATE_FILE = () => join(app.getPath('userData'), 'state.json');

export function registerIpc(getWindow: () => BrowserWindow | null): PtyManager {
  const pty = new PtyManager();

  pty.onData((paneId, data) => {
    const payload: PtyDataEvent = { paneId, data };
    getWindow()?.webContents.send('pty:data', payload);
  });
  pty.onExit((paneId, exitCode) => {
    const payload: PtyExitEvent = { paneId, exitCode };
    getWindow()?.webContents.send('pty:exit', payload);
  });

  ipcMain.handle('pty:spawn', (_e, req: PtySpawnRequest) => {
    pty.spawn(req.paneId, { cwd: req.cwd, cols: req.cols, rows: req.rows });
  });
  ipcMain.on('pty:input', (_e, req: PtyInputRequest) => pty.write(req.paneId, req.data));
  ipcMain.on('pty:resize', (_e, req: PtyResizeRequest) => pty.resize(req.paneId, req.cols, req.rows));
  ipcMain.on('pty:kill', (_e, paneId: string) => pty.kill(paneId));

  ipcMain.handle('state:load', (): AppState => loadStateFromFile(STATE_FILE()));
  ipcMain.handle('state:save', (_e, state: AppState) => saveStateToFile(STATE_FILE(), state));

  ipcMain.handle('dialog:pickDirectory', async () => {
    const win = getWindow();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  return pty;
}
```

- [ ] **Step 2: Write `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerIpc } from './ipc';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0d0d0d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // required so preload can use Node-built IPC bridge
    }
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

const pty = registerIpc(() => mainWindow);

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  pty.killAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => pty.killAll());
```

- [ ] **Step 3: Write `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type {
  RendererApi, PtySpawnRequest, PtyInputRequest, PtyResizeRequest,
  PtyDataEvent, PtyExitEvent, AppState
} from '../shared/types';

const api: RendererApi = {
  spawn: (req: PtySpawnRequest) => ipcRenderer.invoke('pty:spawn', req),
  input: (req: PtyInputRequest) => ipcRenderer.send('pty:input', req),
  resize: (req: PtyResizeRequest) => ipcRenderer.send('pty:resize', req),
  kill: (paneId: string) => ipcRenderer.send('pty:kill', paneId),
  onData: (cb: (e: PtyDataEvent) => void) => {
    const handler = (_e: unknown, payload: PtyDataEvent) => cb(payload);
    ipcRenderer.on('pty:data', handler);
    return () => ipcRenderer.removeListener('pty:data', handler);
  },
  onExit: (cb: (e: PtyExitEvent) => void) => {
    const handler = (_e: unknown, payload: PtyExitEvent) => cb(payload);
    ipcRenderer.on('pty:exit', handler);
    return () => ipcRenderer.removeListener('pty:exit', handler);
  },
  loadState: () => ipcRenderer.invoke('state:load') as Promise<AppState>,
  saveState: (state: AppState) => ipcRenderer.invoke('state:save', state),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory') as Promise<string | null>
};

contextBridge.exposeInMainWorld('api', api);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: add IPC bridge, main entry, and preload"
```

---

## Phase 4 — Renderer Store

### Task 12: zustand store

**Files:**
- Create: `src/renderer/store.ts`

> The store mirrors `AppState` and exposes actions. It uses `window.api` for PTY + persistence. PTY spawning is triggered by the `TerminalView` component when it mounts (it knows the real cols/rows), so the store does NOT spawn directly — it only mutates layout and persists. This keeps the store pure of DOM concerns.

- [ ] **Step 1: Write `src/renderer/store.ts`**

```ts
import { create } from 'zustand';
import type { AppState, PresetKind, Direction, Workspace } from '../shared/types';
import {
  makePreset, splitPane, closePane, setRatio, collectPaneIds
} from '../shared/layout-tree';
import { createIdGenerator } from '../shared/ids';

const nextPaneId = createIdGenerator('p');
const nextSplitId = createIdGenerator('s');
const nextWsId = createIdGenerator('w');

interface StoreState extends AppState {
  maximizedPaneId: string | null;
  hydrated: boolean;
  // lifecycle
  hydrate: () => Promise<void>;
  // workspaces
  activeWorkspace: () => Workspace | undefined;
  selectWorkspace: (id: string) => void;
  addWorkspace: () => void;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  // layout
  applyPreset: (kind: PresetKind) => void;
  splitActivePane: (paneId: string, direction: Direction) => void;
  closeActivePane: (paneId: string) => void;
  resizeSplit: (splitId: string, ratio: number) => void;
  toggleMaximize: (paneId: string) => void;
}

function persist(state: AppState): void {
  void window.api.saveState({
    version: 1,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId
  });
}

export const useStore = create<StoreState>((set, get) => ({
  version: 1,
  workspaces: [],
  activeWorkspaceId: null,
  maximizedPaneId: null,
  hydrated: false,

  hydrate: async () => {
    const loaded = await window.api.loadState();
    set({ ...loaded, hydrated: true });
  },

  activeWorkspace: () => get().workspaces.find((w) => w.id === get().activeWorkspaceId),

  selectWorkspace: (id) => set({ activeWorkspaceId: id, maximizedPaneId: null }),

  addWorkspace: () => {
    const ws: Workspace = {
      id: nextWsId(),
      name: `Workspace ${get().workspaces.length + 1}`,
      cwd: get().workspaces[0]?.cwd ?? '~',
      layout: null
    };
    set((s) => {
      const next = { ...s, workspaces: [...s.workspaces, ws], activeWorkspaceId: ws.id };
      persist(next);
      return next;
    });
  },

  renameWorkspace: (id, name) => set((s) => {
    const next = { ...s, workspaces: s.workspaces.map((w) => w.id === id ? { ...w, name } : w) };
    persist(next);
    return next;
  }),

  deleteWorkspace: (id) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === id);
    if (ws?.layout) collectPaneIds(ws.layout).forEach((pid) => window.api.kill(pid));
    const workspaces = s.workspaces.filter((w) => w.id !== id);
    const activeWorkspaceId = s.activeWorkspaceId === id
      ? (workspaces[0]?.id ?? null)
      : s.activeWorkspaceId;
    const next = { ...s, workspaces, activeWorkspaceId };
    persist(next);
    return next;
  }),

  applyPreset: (kind) => set((s) => {
    const layout = makePreset(kind, nextPaneId, nextSplitId);
    const workspaces = s.workspaces.map((w) =>
      w.id === s.activeWorkspaceId ? { ...w, layout } : w);
    const next = { ...s, workspaces };
    persist(next);
    return next;
  }),

  splitActivePane: (paneId, direction) => set((s) => {
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== s.activeWorkspaceId || !w.layout) return w;
      return { ...w, layout: splitPane(w.layout, paneId, direction, nextPaneId(), nextSplitId()) };
    });
    const next = { ...s, workspaces };
    persist(next);
    return next;
  }),

  closeActivePane: (paneId) => set((s) => {
    window.api.kill(paneId);
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== s.activeWorkspaceId || !w.layout) return w;
      return { ...w, layout: closePane(w.layout, paneId) };
    });
    const next = {
      ...s,
      workspaces,
      maximizedPaneId: s.maximizedPaneId === paneId ? null : s.maximizedPaneId
    };
    persist(next);
    return next;
  }),

  resizeSplit: (splitId, ratio) => set((s) => {
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== s.activeWorkspaceId || !w.layout) return w;
      return { ...w, layout: setRatio(w.layout, splitId, ratio) };
    });
    const next = { ...s, workspaces };
    persist(next);
    return next;
  }),

  toggleMaximize: (paneId) =>
    set((s) => ({ maximizedPaneId: s.maximizedPaneId === paneId ? null : paneId }))
}));
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/store.ts
git commit -m "feat: add zustand renderer store wiring layout-tree + persistence"
```

---

## Phase 5 — UI Components

### Task 13: Styles + React root + App shell

**Files:**
- Create: `src/renderer/styles.css`, `src/renderer/main.tsx`, `src/renderer/App.tsx`

- [ ] **Step 1: Write `src/renderer/styles.css`**

```css
:root {
  --bg: #0d0d0d;
  --panel: #1a1a1a;
  --border: #333;
  --text: #ddd;
  --muted: #888;
  --accent: #c97b4a;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  overflow: hidden;
}
.app { display: flex; height: 100vh; }

.sidebar {
  width: 200px; flex-shrink: 0; background: var(--panel);
  border-right: 1px solid var(--border); padding: 10px; display: flex; flex-direction: column;
}
.sidebar-header { display: flex; justify-content: space-between; align-items: center;
  color: var(--muted); font-size: 11px; letter-spacing: .08em; margin-bottom: 8px; }
.ws-item { display: flex; align-items: center; gap: 6px; padding: 7px 8px;
  border-radius: 6px; cursor: pointer; }
.ws-item.active { background: #2a2a2a; }
.ws-item .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.ws-item .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-item .badge { color: var(--muted); font-size: 11px; }
.ws-item .del { color: var(--muted); visibility: hidden; }
.ws-item:hover .del { visibility: visible; }
.add-ws { color: var(--muted); cursor: pointer; padding: 7px 8px; margin-top: 4px; }
.add-ws:hover { color: var(--text); }
.ws-rename-input { flex: 1; background: #000; color: var(--text);
  border: 1px solid var(--accent); border-radius: 4px; padding: 2px 4px; }

.workspace-view { flex: 1; position: relative; overflow: hidden; }

.welcome { display: flex; flex-direction: column; align-items: center;
  justify-content: center; height: 100%; gap: 20px; }
.welcome h2 { font-weight: 500; opacity: .85; }
.preset-row { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
.preset { cursor: pointer; text-align: center; }
.preset .glyph { width: 90px; height: 64px; border: 1px solid var(--border);
  border-radius: 6px; display: grid; gap: 3px; padding: 3px; }
.preset:hover .glyph { border-color: var(--accent); }
.preset .cell { background: #2a2a2a; border-radius: 3px; }
.preset .label { font-size: 11px; margin-top: 6px; color: var(--muted); }

.split-container { position: absolute; inset: 0; display: flex; }
.split-container.v { flex-direction: column; }
.splitter { background: var(--border); flex-shrink: 0; z-index: 5; }
.split-container.h > .splitter { width: 4px; cursor: col-resize; }
.split-container.v > .splitter { height: 4px; cursor: row-resize; }
.splitter:hover { background: var(--accent); }

.pane { display: flex; flex-direction: column; border: 1px solid var(--border);
  border-radius: 6px; overflow: hidden; min-width: 0; min-height: 0; }
.pane-header { display: flex; align-items: center; gap: 6px; padding: 5px 8px;
  background: #141414; border-bottom: 1px solid var(--border); }
.pane-title { flex: 1; color: var(--muted); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.pane-btn { color: var(--muted); cursor: pointer; padding: 0 3px; background: none;
  border: none; font-size: 13px; }
.pane-btn:hover { color: var(--text); }
.pane-body { flex: 1; min-height: 0; }
.pane-body .xterm { height: 100%; padding: 4px; }

.maximized-host { position: absolute; inset: 8px; }
```

- [ ] **Step 2: Write `src/renderer/main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 3: Write `src/renderer/App.tsx`**

```tsx
import React, { useEffect } from 'react';
import { useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { WorkspaceView } from './components/WorkspaceView';

export function App(): JSX.Element {
  const hydrated = useStore((s) => s.hydrated);
  const hydrate = useStore((s) => s.hydrate);

  useEffect(() => { void hydrate(); }, [hydrate]);

  if (!hydrated) return <div className="app" />;

  return (
    <div className="app">
      <Sidebar />
      <WorkspaceView />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: FAIL — `./components/Sidebar` and `./components/WorkspaceView` not found yet. This is expected; they are built in the next tasks. (Do not commit until Task 17.)

### Task 14: Sidebar

**Files:**
- Create: `src/renderer/components/Sidebar.tsx`

- [ ] **Step 1: Write `src/renderer/components/Sidebar.tsx`**

```tsx
import React, { useState } from 'react';
import { useStore } from '../store';
import { collectPaneIds } from '../../shared/layout-tree';

export function Sidebar(): JSX.Element {
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeWorkspaceId);
  const selectWorkspace = useStore((s) => s.selectWorkspace);
  const addWorkspace = useStore((s) => s.addWorkspace);
  const renameWorkspace = useStore((s) => s.renameWorkspace);
  const deleteWorkspace = useStore((s) => s.deleteWorkspace);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commit = (id: string) => {
    if (draft.trim()) renameWorkspace(id, draft.trim());
    setEditingId(null);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header"><span>WORKSPACES</span></div>
      {workspaces.map((w) => {
        const count = collectPaneIds(w.layout).length;
        return (
          <div
            key={w.id}
            className={`ws-item ${w.id === activeId ? 'active' : ''}`}
            onClick={() => selectWorkspace(w.id)}
            onDoubleClick={() => { setEditingId(w.id); setDraft(w.name); }}
          >
            <span className="dot" />
            {editingId === w.id ? (
              <input
                className="ws-rename-input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit(w.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit(w.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="name">{w.name}</span>
                <span className="badge">{count}</span>
                <span
                  className="del"
                  title="Delete workspace"
                  onClick={(e) => { e.stopPropagation(); deleteWorkspace(w.id); }}
                >✕</span>
              </>
            )}
          </div>
        );
      })}
      <div className="add-ws" onClick={addWorkspace}>+ Workspace</div>
    </div>
  );
}
```

### Task 15: WelcomeScreen + WorkspaceView

**Files:**
- Create: `src/renderer/components/WelcomeScreen.tsx`, `src/renderer/components/WorkspaceView.tsx`

- [ ] **Step 1: Write `src/renderer/components/WelcomeScreen.tsx`**

```tsx
import React from 'react';
import { useStore } from '../store';
import type { PresetKind } from '../../shared/types';

interface PresetDef { kind: PresetKind; label: string; cols: number; rows: number; cells: number; }

const PRESETS: PresetDef[] = [
  { kind: '1',  label: '1 Pane',       cols: 1, rows: 1, cells: 1 },
  { kind: '2h', label: '2 side by side', cols: 2, rows: 1, cells: 2 },
  { kind: '2v', label: '2 stacked',    cols: 1, rows: 2, cells: 2 },
  { kind: '4',  label: '4 (2×2)',      cols: 2, rows: 2, cells: 4 },
  { kind: '8',  label: '8 (2×4)',      cols: 4, rows: 2, cells: 8 }
];

export function WelcomeScreen(): JSX.Element {
  const applyPreset = useStore((s) => s.applyPreset);
  return (
    <div className="welcome">
      <h2>How many terminals do you want to open?</h2>
      <div className="preset-row">
        {PRESETS.map((p) => (
          <div key={p.kind} className="preset" onClick={() => applyPreset(p.kind)}>
            <div
              className="glyph"
              style={{
                width: p.cols > 2 ? 130 : 90,
                gridTemplateColumns: `repeat(${p.cols}, 1fr)`,
                gridTemplateRows: `repeat(${p.rows}, 1fr)`
              }}
            >
              {Array.from({ length: p.cells }).map((_, i) => <div key={i} className="cell" />)}
            </div>
            <div className="label">{p.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/renderer/components/WorkspaceView.tsx`**

```tsx
import React from 'react';
import { useStore } from '../store';
import { WelcomeScreen } from './WelcomeScreen';
import { LayoutRenderer } from './LayoutRenderer';
import { Pane } from './Pane';

export function WorkspaceView(): JSX.Element {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));
  const maximizedPaneId = useStore((s) => s.maximizedPaneId);

  if (!ws) return <div className="workspace-view" />;
  if (!ws.layout) {
    return <div className="workspace-view"><WelcomeScreen /></div>;
  }

  if (maximizedPaneId) {
    return (
      <div className="workspace-view">
        <div className="maximized-host">
          <Pane paneId={maximizedPaneId} cwd={ws.cwd} />
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-view">
      <LayoutRenderer node={ws.layout} cwd={ws.cwd} />
    </div>
  );
}
```

### Task 16: LayoutRenderer + Splitter + Pane + TerminalView

**Files:**
- Create: `src/renderer/components/LayoutRenderer.tsx`, `src/renderer/components/Splitter.tsx`, `src/renderer/components/Pane.tsx`, `src/renderer/components/TerminalView.tsx`

- [ ] **Step 1: Write `src/renderer/components/Splitter.tsx`**

```tsx
import React, { useCallback } from 'react';
import { useStore } from '../store';
import type { Direction } from '../../shared/types';

interface Props { splitId: string; direction: Direction; containerRef: React.RefObject<HTMLDivElement>; }

export function Splitter({ splitId, direction, containerRef }: Props): JSX.Element {
  const resizeSplit = useStore((s) => s.resizeSplit);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const ratio = direction === 'h'
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      resizeSplit(splitId, ratio);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [splitId, direction, containerRef, resizeSplit]);

  return <div className="splitter" onMouseDown={onMouseDown} />;
}
```

- [ ] **Step 2: Write `src/renderer/components/LayoutRenderer.tsx`**

```tsx
import React, { useRef } from 'react';
import type { LayoutNode } from '../../shared/types';
import { Splitter } from './Splitter';
import { Pane } from './Pane';

interface Props { node: LayoutNode; cwd: string; }

export function LayoutRenderer({ node, cwd }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === 'pane') {
    return <Pane paneId={node.id} cwd={cwd} />;
  }

  const first = `${node.ratio * 100}%`;
  const second = `${(1 - node.ratio) * 100}%`;

  return (
    <div ref={containerRef} className={`split-container ${node.direction}`}>
      <div style={node.direction === 'h' ? { width: first } : { height: first }}
           className="split-child">
        <LayoutRenderer node={node.children[0]} cwd={cwd} />
      </div>
      <Splitter splitId={node.id} direction={node.direction} containerRef={containerRef} />
      <div style={node.direction === 'h' ? { width: second } : { height: second }}
           className="split-child">
        <LayoutRenderer node={node.children[1]} cwd={cwd} />
      </div>
    </div>
  );
}
```

> Add to `styles.css` (append): `.split-child { position: relative; min-width: 0; min-height: 0; overflow: hidden; }` — include this in the same commit.

- [ ] **Step 3: Write `src/renderer/components/TerminalView.tsx`**

```tsx
import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

interface Props { paneId: string; cwd: string; }

export function TerminalView({ paneId, cwd }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({
      fontFamily: 'Menlo, "Cascadia Mono", monospace',
      fontSize: 13,
      theme: { background: '#0d0d0d', foreground: '#ddd' },
      cursorBlink: true
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try { term.loadAddon(new WebglAddon()); } catch { /* fallback to canvas */ }
    fit.fit();

    void window.api.spawn({ paneId, cwd, cols: term.cols, rows: term.rows });

    const offData = window.api.onData((e) => { if (e.paneId === paneId) term.write(e.data); });
    const offExit = window.api.onExit((e) => {
      if (e.paneId === paneId) term.write(`\r\n[Process exited — code ${e.exitCode}]\r\n`);
    });
    const inputDisp = term.onData((data) => window.api.input({ paneId, data }));

    const resize = () => {
      fit.fit();
      window.api.resize({ paneId, cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    return () => {
      ro.disconnect();
      offData();
      offExit();
      inputDisp.dispose();
      term.dispose();
    };
    // paneId is stable for the component's lifetime; cwd only matters at spawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  return <div className="xterm-host" ref={hostRef} style={{ height: '100%' }} />;
}
```

> Note: the PTY is **not** killed on unmount here, because unmount also happens on workspace switch and maximize toggle — killing would destroy the shell. PTYs are killed explicitly via `closeActivePane` / `deleteWorkspace` in the store. On workspace switch the terminal is unmounted but its PTY keeps running; switching back remounts and re-attaches via a fresh `spawn` call which is a no-op for an existing paneId (PtyManager guards duplicates) — but buffered output that arrived while unmounted is lost. This is acceptable for v1 (documented limitation).

- [ ] **Step 4: Write `src/renderer/components/Pane.tsx`**

```tsx
import React from 'react';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';

interface Props { paneId: string; cwd: string; }

export function Pane({ paneId, cwd }: Props): JSX.Element {
  const splitActivePane = useStore((s) => s.splitActivePane);
  const closeActivePane = useStore((s) => s.closeActivePane);
  const toggleMaximize = useStore((s) => s.toggleMaximize);
  const maximized = useStore((s) => s.maximizedPaneId === paneId);

  return (
    <div className="pane">
      <div className="pane-header">
        <span className="pane-title">{cwd}</span>
        <button className="pane-btn" title="Split right (left/right)"
                onClick={() => splitActivePane(paneId, 'h')}>▥</button>
        <button className="pane-btn" title="Split down (top/bottom)"
                onClick={() => splitActivePane(paneId, 'v')}>▤</button>
        <button className="pane-btn" title={maximized ? 'Restore' : 'Maximize'}
                onClick={() => toggleMaximize(paneId)}>{maximized ? '🗗' : '⤢'}</button>
        <button className="pane-btn" title="Close"
                onClick={() => closeActivePane(paneId)}>✕</button>
      </div>
      <div className="pane-body">
        <TerminalView paneId={paneId} cwd={cwd} />
      </div>
    </div>
  );
}
```

### Task 17: Run the app end-to-end (manual verification)

**Files:** none (verification + commit of Phase 5)

- [ ] **Step 1: Typecheck the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (all components now exist).

- [ ] **Step 2: Launch the app**

Run: `npm run dev`
Expected: an Electron window opens showing the sidebar with "Workspace 1" and the welcome screen with 5 preset glyphs.

- [ ] **Step 3: Manual smoke checklist** (perform each, confirm behavior)

  - Click preset "4 (2×2)" → four panes appear, each showing a live shell prompt.
  - Type `echo hello` + Enter in one pane → output appears in that pane only.
  - Click ▥ on a pane → it splits left/right into two shells.
  - Drag a divider → panes resize smoothly.
  - Click ⤢ on a pane → it fills the area; click 🗗 → layout restored.
  - Click ✕ on a pane → it closes and the neighbor reclaims the space.
  - Close every pane → welcome screen returns for that workspace.
  - Click "+ Workspace" → new workspace; double-click its name → rename works.
  - Switch between workspaces → each keeps its own layout.
  - Quit and relaunch (`npm run dev`) → workspaces, names, and layouts are restored (fresh shells).

- [ ] **Step 4: Commit Phases 4–5**

```bash
git add src/renderer
git commit -m "feat: implement renderer UI (sidebar, welcome, tiling grid, terminals)"
```

---

## Phase 6 — Packaging, Signing & Notarization (macOS first)

> **Prerequisites (user has these via the existing Apple Developer account):**
> - A **Developer ID Application** certificate installed in the login keychain
>   (check: `security find-identity -v -p codesigning` → an entry like
>   `Developer ID Application: <Name> (<TEAMID>)`).
> - The **Team ID** (10-char, e.g. `AB12CD34EF`).
> - An **app-specific password** for the Apple ID (create at appleid.apple.com →
>   Sign-In & Security → App-Specific Passwords). Used for notarization.
>
> **Secrets are never committed.** They are passed via environment variables only.
> An alternative to the app-specific password is an App Store Connect API key
> (`.p8`); steps for that are noted at the end of Task 19.

### Task 18: App icon (macOS 26 Liquid Glass — dark bg, 4 tiles, "DM" wordmark)

> **Reference:** sibling project `../DM-Voice` ships a 1024×1024 master image and
> generates all sizes from it (there via `cargo tauri icon`). We mirror that approach
> but for Electron: an SVG master → rasterized PNGs → `.icns` (macOS) + `.ico` (Windows).
>
> **macOS 26 (Tahoe) "Liquid Glass":** the system applies the glass/specular treatment
> to icons authored as a layered `.icon` file via Apple's **Icon Composer** (ships with
> Xcode 26). Icon Composer is a GUI tool, so the automated build below paints a
> glass-like look directly into the SVG (translucent tiles, top specular highlight, soft
> inner shadow) and produces a standard `.icns`. **Optional manual enhancement** (Step 7)
> documents importing the SVG layers into Icon Composer to get the true system glass.

**Files:**
- Create: `build/icon-master.svg`, `build/generate-icons.mjs`
- Generated (committed): `build/icon.icns`, `build/icon.ico`, `build/icon.png`

- [ ] **Step 1: Install rasterization tooling**

Run: `npm i -D sharp png-to-ico`
Expected: installs (sharp bundles librsvg for SVG input).

- [ ] **Step 2: Create `build/icon-master.svg`** (1024×1024; dark squircle, 2×2 glass tiles, "DM")

```svg
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c1c1f"/>
      <stop offset="1" stop-color="#0a0a0b"/>
    </linearGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3a3a42" stop-opacity="0.95"/>
      <stop offset="0.5" stop-color="#26262c" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#17171b" stop-opacity="0.95"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="0.45" stop-color="#ffffff" stop-opacity="0.04"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>

  <!-- background squircle (Big Sur+ rounded square) -->
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)"/>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#gloss)"/>

  <!-- 2x2 glass tiles -->
  <g filter="url(#soft)">
    <rect x="178" y="178" width="312" height="312" rx="56" fill="url(#tile)"/>
    <rect x="534" y="178" width="312" height="312" rx="56" fill="url(#tile)"/>
    <rect x="178" y="534" width="312" height="312" rx="56" fill="url(#tile)"/>
    <rect x="534" y="534" width="312" height="312" rx="56" fill="url(#tile)"/>
  </g>
  <!-- per-tile top specular highlight -->
  <g>
    <rect x="178" y="178" width="312" height="156" rx="56" fill="url(#gloss)"/>
    <rect x="534" y="178" width="312" height="156" rx="56" fill="url(#gloss)"/>
    <rect x="178" y="534" width="312" height="156" rx="56" fill="url(#gloss)"/>
    <rect x="534" y="534" width="312" height="156" rx="56" fill="url(#gloss)"/>
  </g>

  <!-- DM wordmark -->
  <text x="512" y="512" text-anchor="middle" dominant-baseline="central"
        font-family="-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif"
        font-size="300" font-weight="700" letter-spacing="-8"
        fill="#ffffff" fill-opacity="0.95">DM</text>
</svg>
```

- [ ] **Step 3: Create `build/generate-icons.mjs`**

```js
// build/generate-icons.mjs — renders icon-master.svg into .icns/.ico/.png
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const svg = join(dir, 'icon-master.svg');
const iconset = join(dir, 'icon.iconset');

const render = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

// 1) macOS .iconset (name -> pixel size)
const variants = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024]
];
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
for (const [name, size] of variants) {
  writeFileSync(join(iconset, name), await render(size));
}

// 2) .icns via iconutil (macOS only)
execSync(`iconutil -c icns -o "${join(dir, 'icon.icns')}" "${iconset}"`);

// 3) 1024 master png (electron-builder fallback / Linux)
writeFileSync(join(dir, 'icon.png'), await render(1024));

// 4) Windows .ico from a 256 png
writeFileSync(join(dir, 'icon-256.png'), await render(256));
const ico = await pngToIco([join(dir, 'icon-256.png')]);
writeFileSync(join(dir, 'icon.ico'), ico);
rmSync(join(dir, 'icon-256.png'), { force: true });

console.log('Icons generated: build/icon.icns, build/icon.ico, build/icon.png');
```

- [ ] **Step 4: Generate the icons**

Run: `node build/generate-icons.mjs`
Expected: prints `Icons generated: ...`; creates `build/icon.icns`, `build/icon.ico`, `build/icon.png`.

- [ ] **Step 5: Visually verify the master**

Run: `open build/icon.png`
Expected: dark rounded-square icon with a 2×2 grid of glassy tiles and a white "DM" wordmark centered. Confirm it reads cleanly at small sizes too (`open build/icon.iconset`).

- [ ] **Step 6: Commit**

```bash
git add build/icon-master.svg build/generate-icons.mjs build/icon.icns build/icon.ico build/icon.png package.json package-lock.json
git commit -m "feat: add app icon (dark 2x2 glass tiles + DM wordmark)"
```

- [ ] **Step 7 (optional, manual — true macOS 26 Liquid Glass):**

For the system-rendered glass treatment on macOS 26, open Apple's **Icon Composer**
(Xcode 26 → Open Developer Tool → Icon Composer), recreate the layers from
`build/icon-master.svg` (background, 4 tiles, "DM"), let Icon Composer apply the glass
material, and export. Replace `build/icon.icns` with the exported `.icns`. This step is
GUI-only and optional; the painted SVG above is the automated baseline.

### Task 19: electron-builder config + entitlements (signing-ready)

**Files:**
- Modify: `package.json` (add `build` block)
- Create: `build/entitlements.mac.plist`

- [ ] **Step 1: Add `build` config to `package.json`** (top-level key)

```json
"build": {
  "appId": "de.dmworkspace.app",
  "productName": "DM Workspace",
  "files": ["out/**/*", "package.json"],
  "asarUnpack": ["**/node_modules/node-pty/**"],
  "afterSign": "build/notarize.cjs",
  "mac": {
    "target": ["dmg"],
    "category": "public.app-category.developer-tools",
    "icon": "build/icon.icns",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist"
  },
  "win": {
    "target": ["nsis"],
    "icon": "build/icon.ico"
  },
  "directories": { "output": "dist" }
}
```

- [ ] **Step 2: Create `build/entitlements.mac.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

> These entitlements are required because Electron uses JIT and node-pty loads an
> unsigned-by-Apple native module; without `disable-library-validation` the
> hardened runtime would block node-pty at launch.

- [ ] **Step 3: Commit**

```bash
git add package.json build/entitlements.mac.plist
git commit -m "chore: add electron-builder config + hardened-runtime entitlements"
```

### Task 20: Notarization hook + signed, notarized build

**Files:**
- Create: `build/notarize.cjs`

- [ ] **Step 1: Install the notarization tool**

Run: `npm i -D @electron/notarize`
Expected: installs.

- [ ] **Step 2: Create `build/notarize.cjs`** (electron-builder `afterSign` hook)

```js
// build/notarize.cjs
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  // Skip notarization unless credentials are present (e.g. local dev builds).
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.warn('Skipping notarization: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath} ...`);
  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  });
  console.log('Notarization complete.');
};
```

- [ ] **Step 3: Confirm the signing identity is available**

Run: `security find-identity -v -p codesigning`
Expected: lists a line `Developer ID Application: <Name> (<TEAMID>)`. Note the Team ID.
If absent, the user must install the Developer ID Application certificate from
the Apple Developer portal / Xcode → Settings → Accounts → Manage Certificates.

- [ ] **Step 4: Run the signed + notarized build**

Run (replace placeholders with real values; do NOT commit them):
```bash
export APPLE_ID="karl_dall@gmx.de"          # the Apple Developer account email
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
npm run dist:mac
```
Expected: electron-builder signs with the Developer ID Application cert, the
`afterSign` hook uploads to Apple's notary service and waits for success
(`Notarization complete.`), then staples the ticket. Produces a notarized
`dist/DM Workspace-0.1.0-arm64.dmg` (and/or x64). This step takes several
minutes (Apple-side processing).

- [ ] **Step 5: Verify signature, notarization & stapling**

Run:
```bash
APP="dist/mac-arm64/DM Workspace.app"   # adjust arch folder if needed
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose "$APP"
xcrun stapler validate "$APP"
```
Expected:
- `codesign` → `valid on disk` / `satisfies its Designated Requirement`.
- `spctl` → `accepted` and `source=Notarized Developer ID`.
- `stapler validate` → `The validate action worked!`.

- [ ] **Step 6: Verify the DMG is also stapled**

Run: `xcrun stapler validate "dist/DM Workspace-0.1.0-arm64.dmg"`
Expected: `The validate action worked!` (electron-builder staples the dmg too).

- [ ] **Step 7: Commit the hook**

```bash
git add build/notarize.cjs package.json package-lock.json
git commit -m "chore: add macOS notarization (afterSign hook via @electron/notarize)"
```

> **Alternative — App Store Connect API key** (instead of app-specific password):
> create an API key in App Store Connect (Users and Access → Integrations → Keys),
> download the `.p8`, and set `appleApiKey`, `appleApiKeyId`, `appleApiIssuer` in the
> `notarize({...})` call (replacing `appleId`/`appleIdPassword`/`teamId`) with the
> corresponding `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` env vars.
> The API key is preferable for CI (GitLab) since it has no 2FA interaction.

---

## Phase 7 — E2E Smoke Test

### Task 21: Playwright smoke test

**Files:**
- Create: `e2e/smoke.spec.ts`, `playwright.config.ts`

- [ ] **Step 1: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false
});
```

- [ ] **Step 2: Install Playwright test runner**

Run: `npm i -D @playwright/test`
Expected: installs.

- [ ] **Step 3: Write `e2e/smoke.spec.ts`**

```ts
import { test, expect, _electron as electron } from '@playwright/test';

test('launches, shows welcome, applies a preset', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] });
  const win = await app.firstWindow();

  // Welcome screen visible
  await expect(win.getByText('How many terminals do you want to open?')).toBeVisible();

  // Apply the "4 (2×2)" preset
  await win.getByText('4 (2×2)').click();

  // Four pane headers (each has a close button ✕) should appear
  await expect(win.locator('.pane')).toHaveCount(4);

  await app.close();
});
```

- [ ] **Step 4: Build then run the E2E test**

Run: `npm run build && npx playwright test`
Expected: PASS — window opens, welcome text found, 4 panes after clicking the preset.

- [ ] **Step 5: Commit**

```bash
git add e2e/smoke.spec.ts playwright.config.ts package.json package-lock.json
git commit -m "test: add Playwright electron smoke test"
```

---

## Self-Review Notes (coverage of the spec)

- **Welcome-Screen, 5 Presets** → Task 7 (logic), Task 15 (UI), Task 19 (E2E). ✔
- **Sidebar workspaces: switch / add / rename / delete, badge count** → Task 12 (store), Task 14 (UI). ✔
- **Tiling grid, pane = one terminal** → Tasks 3–7, 16. ✔
- **Split horizontal/vertical** → Task 4 (logic), Task 16 (Pane buttons). ✔
- **Close pane with collapse / neighbor reclaims space** → Task 5, Task 16. ✔
- **Mouse resize via draggable dividers** → Task 6 (setRatio), Task 16 (Splitter). ✔
- **Maximize / restore** → Task 12 (toggleMaximize), Tasks 15–16. ✔
- **Last pane closed → welcome screen** → Task 5 (returns null), Task 15 (WorkspaceView). ✔
- **Persistence: layouts + names + cwd survive restart, fresh shells** → Tasks 8–9, store `persist`, TerminalView spawn. ✔
- **Per-workspace cwd** → `Workspace.cwd`, used at spawn. ✔
- **Real shells, node-pty, cross-platform shell default** → Task 10. ✔
- **Electron, contextBridge, no nodeIntegration** → Task 11. ✔
- **All UI strings in English (v1)** → Tasks 13–16, 21 (E2E). ✔
- **App icon: macOS 26 Liquid Glass, dark bg, 2×2 tiles, "DM" wordmark** → Task 18. ✔
- **macOS packaging first, Windows config present for later** → Task 19. ✔
- **Signing (Developer ID) + notarization + stapling** → Task 20. ✔

**Open limitation (documented, accepted for v1):** output that arrives while a workspace is switched away (terminal unmounted) is not buffered/replayed on return. A future enhancement could keep terminals mounted but hidden, or buffer PTY output in the main process.
