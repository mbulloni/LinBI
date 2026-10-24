#!/usr/bin/env node
// PreToolUse hook (Edit|Write): blocks edits to secrets and to generated/licensed data.
// Adapted from claude-assisted-project-boilerplate. Exit 2 = block, stderr = feedback to Claude.
// Overrides: CLAUDE_MIBBI_DISABLE_PATH_GATE=1 (session) | touch <tmp>/mib-bi-path-unlock (10 min).
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UNLOCK = join(tmpdir(), "mib-bi-path-unlock");
if (process.env.CLAUDE_MIBBI_DISABLE_PATH_GATE === "1") process.exit(0);
if (existsSync(UNLOCK) && (Date.now() - statSync(UNLOCK).mtimeMs) / 1000 < 600) process.exit(0);

const PROTECTED = [
  [/(^|\/)\.env(\.|$)/i, "environment file (secrets)"],
  [/\.(pem|key|p12)$/i, "key material"],
  [/\.config\/(mib-bi|MiB-BI)\/(powerbi|claude|web-credentials)[^/]*\.json$/i, "MiB-BI stored credentials (safeStorage)"],
  [/(^|\/)src\/geo\/[^/]+\.json$/i, "generated geo data (Natural Earth / US Census / ISTAT / GeoNames): regenerate with scripts/build-geo.mjs"],
  [/(^|\/)LICENSE$/, "license"],
];

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let file = "";
  try { file = JSON.parse(Buffer.concat(chunks).toString())?.tool_input?.file_path ?? ""; } catch { process.exit(0); }
  const p = file.replace(/\\/g, "/");
  for (const [pattern, reason] of PROTECTED) {
    if (pattern.test(p)) {
      process.stderr.write(`HOOK: edit blocked.\nPath: ${p}\nReason: ${reason}\nOverride: CLAUDE_MIBBI_DISABLE_PATH_GATE=1 | touch ${UNLOCK} (10 min).`);
      process.exit(2);
    }
  }
  process.exit(0);
});
