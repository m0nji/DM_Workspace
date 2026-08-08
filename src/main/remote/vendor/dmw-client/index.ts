// AUTO-GENERIERT aus dm_workspace_web@880d025 — nicht editieren, npm run sync:dmw-client

// @dmw/client – umgebungsunabhängiger WebSocket-Transport für DM Workspace.
//
// `exports`/`types` zeigen bewusst auf die TypeScript-Quelle: Innerhalb des
// Monorepos konsumieren Vite (web) und tsx (server-Tooling) Workspace-Pakete
// direkt als Quelle, wie bei @dmw/shared. `npm run build -w client` emittiert
// zusätzlich nach dist/ (JS + .d.ts) – das Umhängen der exports auf dist/
// passiert erst mit der noch offenen Publishing-Entscheidung.
export * from './workspace-client.js'
