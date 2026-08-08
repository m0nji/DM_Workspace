#!/usr/bin/env node
// Vendoring von @dmw/shared und @dmw/client aus dem Repo dm_workspace_web
// (Remote-Workspaces-Plan, Arbeitspaket B2). Entscheidung: Kopie mit
// Sync-Skript statt Package-Registry, bis die Publishing-Frage entschieden ist.
//
//   npm run sync:dmw-client
//
// Quelle: $DMW_WEB_REPO oder ../dm_workspace_web bzw. ../../dm_workspace_web
// relativ zum Repo-Root. Kopiert shared/src/** und client/src/** nach
// src/main/remote/vendor/{dmw-shared,dmw-client}/ und stellt jeder Datei einen
// Kopf-Kommentar mit dem Quell-Commit voran. Die Imports `@dmw/shared` im
// kopierten Client-Code bleiben unangetastet — sie werden über tsconfig-Paths
// und electron-vite resolve.alias auf den Vendor-Ordner aufgelöst.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findSourceRepo() {
  const candidates = process.env.DMW_WEB_REPO
    ? [process.env.DMW_WEB_REPO]
    : [join(repoRoot, '..', 'dm_workspace_web'), join(repoRoot, '..', '..', 'dm_workspace_web')];
  for (const cand of candidates) {
    if (existsSync(join(cand, 'shared', 'src')) && existsSync(join(cand, 'client', 'src'))) {
      return resolve(cand);
    }
  }
  console.error(
    'dm_workspace_web nicht gefunden. Pfad über die Umgebungsvariable DMW_WEB_REPO setzen\n' +
    `(geprüft: ${candidates.join(', ')}).`
  );
  process.exit(1);
}

const sourceRepo = findSourceRepo();
const commit = execFileSync('git', ['-C', sourceRepo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const header =
  `// AUTO-GENERIERT aus dm_workspace_web@${commit} — nicht editieren, npm run sync:dmw-client\n\n`;

function annotate(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      annotate(path);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      writeFileSync(path, header + readFileSync(path, 'utf8'));
    }
  }
}

const targets = [
  { from: join(sourceRepo, 'shared', 'src'), to: join(repoRoot, 'src', 'main', 'remote', 'vendor', 'dmw-shared') },
  { from: join(sourceRepo, 'client', 'src'), to: join(repoRoot, 'src', 'main', 'remote', 'vendor', 'dmw-client') }
];

for (const { from, to } of targets) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  annotate(to);
  console.log(`${from} -> ${to} (@${commit})`);
}
