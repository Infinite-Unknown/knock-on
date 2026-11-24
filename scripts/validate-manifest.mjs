// Offline checks that `forge lint` would run, for machines where the Forge CLI
// itself cannot start (it pins a Node range). Runs:
//   1. the full manifest validation from @forge/manifest (schema, resources, functions, scopes)
//   2. the client-side linters from @forge/lint over src/ (handlers, permissions, scopes used by API calls)
// No network, no Atlassian login. `forge lint` on a supported Node remains the reference.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import manifestPkg from '@forge/manifest';
import lintPkg from '@forge/lint';
import yaml from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

let failed = false;

const result = await manifestPkg.validate(false);
if (!result.success) {
  failed = true;
  console.error('Manifest validation FAILED:');
  for (const e of result.errors ?? []) console.error(`  - ${e.message}${e.reference ? ` (${e.reference})` : ''}`);
} else {
  console.log('Manifest validation: OK');
}

const manifest = yaml.parse(readFileSync('manifest.yml', 'utf8'));
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) files.push(p);
  }
})('src');

const statsig = {
  checkGate: async () => false,
  getDynamicConfig: async () => null,
  getDeprecatedRuntimes: async () => [],
};
const messages = [];
const logger = { info: (m) => messages.push(m), warn: (m) => messages.push(m), error: (m) => messages.push(m), debug: () => {} };

try {
  const lintResults = await lintPkg.lint(files, manifest, 'development', logger, statsig, { linter: { mode: 'client-side' } });
  let errors = 0;
  let warnings = 0;
  for (const r of lintResults) {
    for (const e of r.errors ?? []) {
      errors += 1;
      console.error(`  error   ${r.file ?? ''}:${e.line ?? ''} ${e.message}`);
    }
    for (const w of r.warnings ?? []) {
      warnings += 1;
      console.warn(`  warning ${r.file ?? ''}:${w.line ?? ''} ${w.message}`);
    }
  }
  console.log(`Lint (${files.length} files): ${errors} errors, ${warnings} warnings`);
  if (errors > 0) failed = true;
} catch (error) {
  failed = true;
  console.error(`Lint could not run: ${error.stack ?? error}`);
}

process.exit(failed ? 1 : 0);
