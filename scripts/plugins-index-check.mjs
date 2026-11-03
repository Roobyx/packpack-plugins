// Fails when `plugins/index.json` is stale.
//
// The generated file is compared with a fresh build using the committed ref and
// timestamp, so the check catches a manifest or source edit without a
// regeneration and never fails merely because the clock moved.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from './plugins-index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(root, 'plugins', 'index.json');

let committed;
try {
  committed = JSON.parse(readFileSync(indexPath, 'utf8'));
} catch (error) {
  console.error(`plugins/index.json is missing or unreadable: ${String(error)}`);
  process.exit(1);
}

const rebuilt = buildIndex({ ref: committed.ref, generatedAt: committed.generatedAt });

if (JSON.stringify(rebuilt) !== JSON.stringify(committed)) {
  console.error('plugins/index.json is stale.');
  console.error('Run: node scripts/plugins-index.mjs --ref <commit-sha>');
  const expected = JSON.stringify(rebuilt, null, 2).split('\n');
  const actual = JSON.stringify(committed, null, 2).split('\n');
  for (let line = 0; line < Math.max(expected.length, actual.length); line++) {
    if (expected[line] !== actual[line]) {
      console.error(`  first difference at line ${line + 1}`);
      console.error(`  expected: ${expected[line] ?? '(end)'}`);
      console.error(`  found:    ${actual[line] ?? '(end)'}`);
      break;
    }
  }
  process.exit(1);
}

if (committed.ref === 'main') {
  console.warn(
    'plugins index warning: ref is "main"; regenerate with --ref <commit-sha> before a release',
  );
}
console.log(`plugins index ok (${committed.plugins.length} plugins)`);
