// Native Codex command hooks: no user config changes and no approval decisions.
export function codexSetup(path: string, port: number, token: string, powershell: boolean): { command: string; script: string } {
  // Base64 keeps paths out of shell syntax on both POSIX and Windows shells.
  const hookCommand = `node -e "require(Buffer.from('${Buffer.from(path).toString('base64')}','base64').toString())"`;
  const events = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'Stop', 'Interrupt', 'SessionEnd'];
  const hook = `{ type = "command", command = ${JSON.stringify(hookCommand)}, timeout = 2 }`;
  const config = `hooks={${events.map(event => `${event}=[{hooks=[${hook}]}]`).join(',')}}`;
  const quoted = powershell ? config.replace(/'/g, "''") : config.replace(/'/g, "'\\''");
  const script = `// DM Workspace: only lifecycle identifiers leave this process.
const http = require('node:http');
let done = false;
function finish() { if (!done) { done = true; process.stdout.write('{}\\n'); process.exit(0); } }
const timer = setTimeout(finish, 900);
let chunks = [], size = 0;
process.stdin.on('error', finish);
process.stdin.on('data', chunk => { size += chunk.length; if (size > 256 * 1024) finish(); else chunks.push(chunk); });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const body = JSON.stringify(Object.fromEntries(['session_id', 'turn_id', 'hook_event_name', 'agent_id', 'tool_use_id', 'stop_hook_active'].filter(key => input[key] !== undefined).map(key => [key, input[key]])));
    const req = http.request({ hostname: '127.0.0.1', port: ${port}, path: '/codex', method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: ${JSON.stringify(`Bearer ${token}`)}, 'X-DMWS-Terminal': process.env.DMWS_AGENT_NONCE || '' } }, res => { res.resume(); res.on('end', finish); });
    req.on('error', finish);
    req.end(body);
  } catch { finish(); }
});
`;
  return { command: `codex -c '${quoted}'`, script };
}
