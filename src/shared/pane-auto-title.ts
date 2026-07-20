export const DMWS_PROMPT_OSC = 777;
export const DMWS_PROMPT_PAYLOAD = 'dmws-prompt';
export const DMWS_PROMPT_SEQUENCE = `\x1b]${DMWS_PROMPT_OSC};${DMWS_PROMPT_PAYLOAD}\x07`;

type AgentKind = 'claude' | 'codex';

export interface PaneAutoTitleTracker {
  /** Called only for a prompt marker emitted by DM Workspace's local shell hook. */
  onShellPrompt(): void;
  /** Raw bytes that are about to be sent to the PTY. */
  onInput(data: string): void;
  dispose(): void;
}

interface TrackerOptions {
  onTitle: (title: string) => void;
  commandMaxLength?: number;
  promptMaxLength?: number;
}

class InputLine {
  private chars: string[] = [];
  private cursor = 0;
  private bracketedPaste = false;
  private escapePending = false;
  private csi = '';
  private stringControl: 'osc' | 'st' | null = null;
  private stringSawEscape = false;

  reset(): void {
    this.chars = [];
    this.cursor = 0;
    this.bracketedPaste = false;
    this.escapePending = false;
    this.csi = '';
    this.stringControl = null;
    this.stringSawEscape = false;
  }

  private insert(value: string): void {
    this.chars.splice(this.cursor, 0, value);
    this.cursor++;
  }

  private eraseBack(): void {
    if (this.cursor === 0) return;
    this.chars.splice(this.cursor - 1, 1);
    this.cursor--;
  }

  private eraseWordBack(): void {
    while (this.cursor > 0 && /\s/.test(this.chars[this.cursor - 1])) this.eraseBack();
    while (this.cursor > 0 && !/\s/.test(this.chars[this.cursor - 1])) this.eraseBack();
  }

  private submit(onSubmit: (line: string) => void): void {
    const line = this.chars.join('');
    this.reset();
    onSubmit(line);
  }

  private applyCsi(seq: string): void {
    if (seq === '[200~') { this.bracketedPaste = true; return; }
    if (seq === '[201~') { this.bracketedPaste = false; return; }
    if (/\[(?:\d+;)*\d*D$/.test(seq)) this.cursor = Math.max(0, this.cursor - 1);
    else if (/\[(?:\d+;)*\d*C$/.test(seq)) this.cursor = Math.min(this.chars.length, this.cursor + 1);
    else if (/\[(?:1~|H)$/.test(seq)) this.cursor = 0;
    else if (/\[(?:4~|F)$/.test(seq)) this.cursor = this.chars.length;
    else if (/\[3~$/.test(seq) && this.cursor < this.chars.length) this.chars.splice(this.cursor, 1);
  }

  feed(data: string, onSubmit: (line: string) => void): void {
    for (let i = 0; i < data.length;) {
      const code = data.codePointAt(i)!;
      const char = String.fromCodePoint(code);

      // OSC 10/11 colour-query replies are sent by xterm back through onData
      // when Codex/Claude start. DCS/APC/PM/SOS replies use the same ST ending.
      // Discard their entire payload, including when it arrives across events.
      if (this.stringControl) {
        if (this.stringControl === 'osc' && char === '\x07') {
          this.stringControl = null;
          this.stringSawEscape = false;
        } else if (this.stringSawEscape && char === '\\') {
          this.stringControl = null;
          this.stringSawEscape = false;
        } else {
          this.stringSawEscape = char === '\x1b';
        }
        i += char.length;
        continue;
      }

      if (this.csi) {
        this.csi += char;
        if (code >= 0x40 && code <= 0x7e) {
          this.applyCsi(this.csi);
          this.csi = '';
        }
        i += char.length;
        continue;
      }

      if (this.escapePending) {
        this.escapePending = false;
        if (char === '[') this.csi = '[';
        else if (char === ']') this.stringControl = 'osc';
        else if (char === 'P' || char === '_' || char === '^' || char === 'X') this.stringControl = 'st';
        // Other ESC-prefixed keys are editing commands; discard both bytes.
        i += char.length;
        continue;
      }

      if (char === '\x1b') {
        this.escapePending = true;
        i += char.length;
        continue;
      }

      if (char === '\r' || char === '\n') {
        if (this.bracketedPaste) this.insert(' ');
        else this.submit(onSubmit);
        i += char.length;
        continue;
      }
      if (char === '\x7f' || char === '\b') this.eraseBack();
      else if (char === '\x01') this.cursor = 0; // Ctrl+A
      else if (char === '\x05') this.cursor = this.chars.length; // Ctrl+E
      else if (char === '\x15') { // Ctrl+U
        this.chars.splice(0, this.cursor);
        this.cursor = 0;
      } else if (char === '\x0b') this.chars.splice(this.cursor); // Ctrl+K
      else if (char === '\x17') this.eraseWordBack(); // Ctrl+W
      else if (char === '\x03') this.reset(); // Ctrl+C
      else if (code >= 0x20 && code !== 0x7f) this.insert(char);
      i += char.length;
    }
  }
}

function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ACTION_WORD = /\b(?:add|analy[sz]|analysier|bau|beheb|build|change|check|commit|create|deploy|document|dokumentier|ergänz|erstell|entfern|find|fix|füg|implement|investigat|mach|migrat|migrier|optimier|optimiz|prüf|publish|refactor|release|remov|review|schreib|show|such|test|untersuch|update|veröffentlich|änder|zeig)[a-zäöüß-]*\b/i;
const REQUEST_LEAD = /^(?:(?:(?:kannst|könntest|würdest)\s+du(?:\s+bitte)?|bitte|lass(?:t)?\s+uns|please|(?:can|could|would)\s+you(?:\s+please)?|let(?:'s|\s+us)|i(?:'d|\s+would)\s+like\s+(?:you\s+)?to|i\s+want\s+(?:you\s+)?to)\s*[,;:\-]?\s*)/i;
const GERMAN_INTENT_LEAD = /^ich\s+(?:möchte|würde(?:\s+gerne)?)(?:\s+gerne)?\s*,?\s*(?:dass\s+du\s+)?/i;
const CONTEXT_LEAD = /^(?:als\s+hintergrund|hintergrund|kontext|wir\s+haben|es\s+gibt|for\s+context|context|we\s+have|there\s+(?:is|are))\b/i;

function redactSensitiveValues(value: string): string {
  return value
    .replace(/\b(api[\s_-]?key|access[\s_-]?token|token|password|passwort|secret)\s*(?:=|:)\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '$1=[versteckt]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [versteckt]');
}

function compactLongPaths(value: string): string {
  return value
    .replace(/(?<![:\w])\/(?:[^/\s]+\/){2,}([^/\s]+)/g, '…/$1')
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\){2,}([^\\\s]+)/g, '…\\$1');
}

function stripRequestLead(value: string): string {
  let result = value.trim();
  let previous = '';
  while (result && result !== previous) {
    previous = result;
    result = result.replace(REQUEST_LEAD, '').replace(GERMAN_INTENT_LEAD, '').trim();
  }
  return result;
}

function promptSentences(value: string): string[] {
  return value.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
}

function sentenceScore(value: string): number {
  let score = 0;
  if (ACTION_WORD.test(value)) score += 4;
  if (REQUEST_LEAD.test(value) || GERMAN_INTENT_LEAD.test(value)) score += 2;
  if (CONTEXT_LEAD.test(value)) score -= 2;
  return score;
}

function titleCaseStart(value: string): string {
  if (!value) return value;
  return value[0].toLocaleUpperCase() + value.slice(1);
}

function shorten(value: string, maxLength: number): string {
  const clean = cleanText(value);
  if (clean.length <= maxLength) return clean;
  const slice = clean.slice(0, Math.max(1, maxLength - 1));
  const boundary = slice.lastIndexOf(' ');
  return `${(boundary >= Math.floor(maxLength * 0.6) ? slice.slice(0, boundary) : slice).trimEnd()}…`;
}

export function commandTitle(command: string, maxLength = 84): string {
  return shorten(command, maxLength);
}

export function promptTitle(prompt: string, maxLength = 64): string {
  const withoutCodeBlocks = prompt.replace(/```[\s\S]*?(?:```|$)/g, ' ');
  const clean = compactLongPaths(redactSensitiveValues(cleanText(withoutCodeBlocks))).replace(/^(?:[-*#>]\s*)+/, '');
  const sentences = promptSentences(clean);
  const sentence = sentences.reduce((best, candidate) => (
    sentenceScore(candidate) > sentenceScore(best) ? candidate : best
  ), sentences[0] ?? clean);
  const concise = titleCaseStart(stripRequestLead(sentence)).replace(/\.$/, '');
  return shorten(concise, maxLength);
}

function isAgentSessionReset(agent: AgentKind, value: string): boolean {
  const command = cleanText(value).toLowerCase();
  if (agent === 'codex') return command === '/new' || command === '/clear';
  return command === '/clear' || command === '/new';
}

function unquote(token: string): string {
  if (token.length >= 2 && ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")))) {
    return token.slice(1, -1);
  }
  return token;
}

function executableName(token: string): string {
  return (unquote(token).split(/[\\/]/).pop() ?? token).toLowerCase().replace(/\.exe$/, '');
}

export function detectAgentCommand(command: string): AgentKind | null {
  // Inspect the executable position of each shell segment, so `echo claude`
  // does not look like an agent while `cd repo && claude` still does.
  for (const segment of command.split(/(?:&&|\|\||[;|])/)) {
    const tokens = segment.match(/"(?:\\.|[^"])*"|'[^']*'|[^\s]+/g)?.map(unquote) ?? [];
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
    if (executableName(tokens[i] ?? '') === 'env') {
      i++;
      while (i < tokens.length && (/^-/.test(tokens[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]))) i++;
    }
    if (executableName(tokens[i] ?? '') === 'sudo') {
      i++;
      while (i < tokens.length && /^-/.test(tokens[i])) i++;
    }
    const executable = executableName(tokens[i] ?? '');
    if (executable === 'claude' || executable === 'codex') return executable;
    if (executable === 'npx' || executable === 'bunx') {
      const packageName = tokens.slice(i + 1).find((token) => !token.startsWith('-'))?.toLowerCase() ?? '';
      if (packageName.includes('claude')) return 'claude';
      if (packageName.includes('codex')) return 'codex';
    }
    if ((executable === 'pnpm' || executable === 'yarn') && tokens[i + 1] === 'dlx') {
      const packageName = (tokens[i + 2] ?? '').toLowerCase();
      if (packageName.includes('claude')) return 'claude';
      if (packageName.includes('codex')) return 'codex';
    }
  }
  return null;
}

export function createPaneAutoTitleTracker(opts: TrackerOptions): PaneAutoTitleTracker {
  const shellLine = new InputLine();
  const agentLine = new InputLine();
  const commandMaxLength = opts.commandMaxLength ?? 84;
  const promptMaxLength = opts.promptMaxLength ?? 64;
  let shellReady = false;
  let seenPrompt = false;
  let agent: AgentKind | null = null;
  let agentPromptCaptured = false;
  let prePromptInput = '';
  let disposed = false;

  const submitAgentPrompt = (raw: string): void => {
    if (!agent) return;
    if (isAgentSessionReset(agent, raw)) {
      agentPromptCaptured = false;
      opts.onTitle(agent === 'claude' ? 'Claude' : 'Codex');
      return;
    }
    if (agentPromptCaptured) return;
    const summary = promptTitle(raw, promptMaxLength);
    // Ignore empty enters and single-key onboarding confirmations. The first
    // substantive submission remains eligible as the actual agent prompt.
    if (summary.length < 3 || /^(?:y|n|yes|no|ja|nein|\d+)$/i.test(summary)) return;
    const agentName = agent === 'claude' ? 'Claude' : 'Codex';
    opts.onTitle(`${agentName} · ${summary}`);
    agentPromptCaptured = true;
  };

  const submitShellCommand = (raw: string): void => {
    const title = commandTitle(raw, commandMaxLength);
    if (!title) return;
    opts.onTitle(title);
    shellReady = false;
    agent = detectAgentCommand(raw);
    agentPromptCaptured = false;
    agentLine.reset();
  };

  const onInput = (data: string): void => {
    if (disposed || !data) return;
    if (!seenPrompt) {
      // Startup commands are queued into the PTY before the shell prints its
      // first prompt. Keep a small copy and replay it once our prompt marker
      // arms the tracker.
      prePromptInput = (prePromptInput + data).slice(-4096);
      return;
    }
    if (shellReady) shellLine.feed(data, submitShellCommand);
    else if (agent) agentLine.feed(data, submitAgentPrompt);
    // Any other running command intentionally ignores input: this prevents an
    // SSH/sudo password or an interactive program's secret input becoming a title.
  };

  return {
    onShellPrompt(): void {
      if (disposed) return;
      const queued = !seenPrompt ? prePromptInput : '';
      seenPrompt = true;
      prePromptInput = '';
      shellReady = true;
      agent = null;
      agentPromptCaptured = false;
      shellLine.reset();
      agentLine.reset();
      opts.onTitle('');
      if (queued) onInput(queued);
    },
    onInput,
    dispose(): void {
      disposed = true;
      prePromptInput = '';
      shellLine.reset();
      agentLine.reset();
    }
  };
}
