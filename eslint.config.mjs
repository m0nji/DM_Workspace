import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Flat config (ESLint 10). Der Zweck dieser Konfiguration ist NICHT Stilprüfung —
// tsc deckt Typen ab, und die Codebasis ist stilistisch bereits konsistent.
// Sie existiert für die Fehlerklassen, die weder Compiler noch Tests fangen:
//
//  - react-hooks/exhaustive-deps: veraltete Closures in langlebigen Effects.
//    Genau die Klasse, aus der die im Review gefundenen TerminalView-Bugs kamen.
//  - no-floating-promises: verschluckte async-Fehler. In einem Electron-Main
//    reicht ein unbehandeltes Reject, um Zustand still auseinanderlaufen zu lassen.
//  - no-misused-promises: async-Callback dort, wo void erwartet wird (Event-
//    Handler, IPC-Listener) — der Fehler landet nirgendwo.
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'build/**',
      'test-results/**',
      'playwright-report/**',
      '.superpowers/**',
      '**/*.asar.unpacked/**'
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Die Root-Configs stehen bewusst in keiner tsconfig — sie über
          // include aufzunehmen würde den Umfang von `npm run typecheck`
          // verändern. Hier bekommen sie das Default-Projekt, damit ESLint sie
          // parsen kann, ohne die Build-Semantik anzufassen.
          allowDefaultProject: ['*.config.ts', '*.config.mjs']
        },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // Ungenutzte Bindings sind fast immer Reste eines halben Refactors. Führendes
      // _ als bewusstes "wird nicht gebraucht" respektieren (im Code bereits gängig,
      // z. B. `_event` in IPC-Handlern).
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none'
      }],
      // Die Codebasis nutzt `as` gezielt und dokumentiert an DOM-/IPC-Grenzen;
      // das als Fehler zu führen erzeugt nur Rauschen ohne Erkenntnis.
      '@typescript-eslint/no-explicit-any': 'warn',

      // AUS, weil die Regel hier nachweislich falsch liegt und ihr Autofix den
      // Build bricht. Bei `el.querySelector('.sel') as HTMLElement | null` greift
      // die generische Überladung `querySelector<E extends Element = Element>`:
      // das Assertion-Ziel treibt die Inferenz von E, der Ausdruck ist also schon
      // vor dem Cast HTMLElement — die Regel hält ihn deshalb für wirkungslos.
      // Entfernt man ihn, fällt E auf Element zurück und tsc bricht mit
      // "Property 'style' does not exist on type 'Element'". Die Assertion ist
      // genau deshalb tragend. Betraf 6 Stellen in TerminalView/e2e; verifiziert
      // mit typescript@6.0.3 (innerhalb der von typescript-eslint unterstützten
      // Range), also keine Versionsinkompatibilität, sondern eine bekannte
      // Grenze der Regel bei generisch typisierten Rückgabewerten.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Template-Literale mit Zahlen/Booleans sind hier durchgehend Absicht
      // (Pixelwerte, Exit-Codes), nicht versehentliche Stringifizierung.
      '@typescript-eslint/restrict-template-expressions': ['error', {
        allowNumber: true,
        allowBoolean: true
      }],

      // AUS: Das hier ist ein Terminal-Emulator. Steuerzeichen in Regexes (\x1b für
      // ESC, \x00-\x1f beim Filtern von Rohausgabe) sind der Gegenstand des Codes,
      // nicht ein Tippfehler — siehe terminal-reset.ts und pane-auto-title.ts.
      'no-control-regex': 'off'
    }
  },

  // Renderer: Browser-Kontext + React-Hooks-Regeln.
  //
  // Bewusst NICHT `recommended-latest` als Ganzes: eslint-plugin-react-hooks v7
  // bündelt dort den React-Compiler-Regelsatz (set-state-in-effect, immutability,
  // refs, purity, …). Der setzt voraus, dass man den Compiler adoptiert — dieses
  // Projekt tut das nicht. Er meldet hier 16-mal an, ausschließlich auf legitimen
  // Mustern: Zustand aus externen Quellen synchronisieren (async File-Loads,
  // Store-Abos, Prop-Sync). Das als Fehler zu führen hieße 16 Suppressions oder
  // einen Umbau ohne Gegenwert.
  //
  // Aktiv sind die beiden klassischen Regeln, um die es geht:
  //  - rules-of-hooks: harte Korrektheit, keine Fehlalarme.
  //  - exhaustive-deps: als Warnung, weil die drei bewussten Mount-once-Effects
  //    im Code sie legitim unterdrücken — sie soll neue Fälle sichtbar machen,
  //    ohne die bestehenden zu Fehlern zu erklären.
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'src/shared/**/*.ts'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },

  // Main/Preload: Node-Kontext.
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: { globals: globals.node }
  },

  // Tests und E2E laufen gegen Mocks und greifen bewusst über Typgrenzen hinweg
  // (window-Stubs, injizierte e2e-Hooks). Die type-aware Regeln, die daran
  // hochgehen, sagen dort nichts über Korrektheit aus.
  {
    files: ['tests/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // `expect(window.api.kill).toHaveBeenCalled…` — die Regel sieht eine vom
      // Objekt gelöste Methode und warnt vor verlorenem `this`. Hier ist das
      // Ziel eine vi.fn()-Attrappe, die kein `this` benutzt; die Warnung trifft
      // in Assertions strukturell immer zu und sagt nichts über Korrektheit.
      '@typescript-eslint/unbound-method': 'off'
    }
  },

  // Build-/Tooling-Skripte sind plain JS ohne Typinformation.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node }
  }
);
