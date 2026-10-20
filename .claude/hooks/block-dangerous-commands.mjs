#!/usr/bin/env node
// PreToolUse hook (Bash): blocks destructive shell commands and reads of LinBI's stored secrets.
// Adapted from claude-assisted-project-boilerplate. Exit 2 = block, stderr = feedback to Claude.
// Overrides: CLAUDE_LINBI_DISABLE_DANGEROUS_GATE=1 (session) | touch <tmp>/linbi-dangerous-unlock (10 min).
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UNLOCK = join(tmpdir(), "linbi-dangerous-unlock");
if (process.env.CLAUDE_LINBI_DISABLE_DANGEROUS_GATE === "1") process.exit(0);
if (existsSync(UNLOCK) && (Date.now() - statSync(UNLOCK).mtimeMs) / 1000 < 600) process.exit(0);

const BLOCKED = [
  [/rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/(?!tmp|var\/tmp)|~|\$HOME|\.\.\/|\*)/i, "rm -rf on a root, home, parent or wildcard path"],
  [/git\s+push\s+.*(-f\b|--force(?!-with-lease))/i, "force push (use --force-with-lease on personal branches)"],
  [/git\s+reset\s+--hard\s+(origin|HEAD~[0-9]+|main|master)/i, "hard reset that drops commits"],
  [/git\s+clean\s+-[a-z]*[fd]/i, "git clean deletes untracked files (docs/screenshots, new sources)"],
  [/git\s+filter-(branch|repo)|git\s+update-ref\s+-d/i, "history rewrite on a public repo"],
  [/gh\s+repo\s+(delete|edit\s+.*--visibility)/i, "repo deletion or visibility change"],
  [/\bdd\s+if=.*of=\/dev\/(sd|nvme|disk)/i, "disk overwrite"],
  // LinBI userData secrets (Power BI refresh tokens, Claude key, Web credentials) — encrypted, but never dump them.
  [/\b(cat|less|more|head|tail|strings|xxd|base64|cp|scp|curl)\b.*\.config\/(linbi|LinBI)\/(powerbi|claude|web-credentials|credentials)[^/\s]*\.json/i, "read/copy of LinBI stored credentials"],
  [/\b(cat|less|more|head|tail)\b.*(\.env(?!\.example)\b|id_rsa\b|\.pem\b)/i, "read of a secret file"],
];

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let command = "";
  try { command = JSON.parse(Buffer.concat(chunks).toString())?.tool_input?.command ?? ""; } catch { process.exit(0); }
  for (const [pattern, reason] of BLOCKED) {
    if (pattern.test(command)) {
      process.stderr.write(`HOOK: command blocked (${reason}).\nOverride: CLAUDE_LINBI_DISABLE_DANGEROUS_GATE=1 | touch ${UNLOCK} (10 min).`);
      process.exit(2);
    }
  }
  process.exit(0);
});
