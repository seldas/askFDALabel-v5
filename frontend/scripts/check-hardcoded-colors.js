#!/usr/bin/env node
/*
 * Guards against new hardcoded hex colors landing in CSS outside the token
 * definitions themselves.
 *
 * There is no lint tooling in this repo (see CLAUDE.md — `next lint` was
 * removed in Next 16 and ESLint isn't a dependency), so this is a plain Node
 * script rather than an ESLint/Stylelint rule pulling in new dependencies for
 * one check. Run it by hand before committing CSS changes:
 *
 *   node scripts/check-hardcoded-colors.js
 *
 * It is not wired into a git hook or CI job — neither exists in this repo —
 * so it is opt-in until the project adopts one.
 */

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..', 'app');

/*
 * Files allowed to contain literal hex: the token definitions themselves.
 * tokens.css *is* the palette; globals.css defines the small --fda-* set of
 * government-chrome colors that intentionally stay outside the app token
 * system (see the note in tokens.css).
 */
const ALLOWED_FILES = new Set(['platform/tokens.css', 'globals.css']);

const HEX_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const DECL_RE = /^\s*--[\w-]+\s*:/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

function main() {
  const files = walk(APP_DIR);
  const findings = [];

  for (const file of files) {
    const rel = path.relative(APP_DIR, file).replace(/\\/g, '/');
    if (ALLOWED_FILES.has(rel)) continue;

    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (DECL_RE.test(line)) return; // a component defining its own --var is fine
      const matches = line.match(HEX_RE);
      if (matches) {
        findings.push({ file: rel, line: i + 1, hex: matches, text: line.trim() });
      }
    });
  }

  if (findings.length === 0) {
    console.log('No hardcoded hex colors found outside the token files.');
    return;
  }

  console.log(`${findings.length} line(s) with hardcoded hex colors:\n`);
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}  ${f.hex.join(', ')}`);
  }
  console.log(
    '\nAdd the value as a token in app/platform/tokens.css and reference it with var(),' +
      ' or add the file to ALLOWED_FILES in this script if the exception is deliberate.',
  );
  process.exitCode = 1;
}

main();
