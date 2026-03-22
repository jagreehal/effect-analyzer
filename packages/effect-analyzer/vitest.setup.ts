import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Some tests use mkdtempSync(join(tmpdir(), ...)).
// On constrained environments, the system temp dir can be full (ENOSPC).
// Point Node's temp dir at a repo-local location during tests.
const tmpRoot = resolve(process.cwd(), '.analysis-output', 'vitest-tmp');
mkdirSync(tmpRoot, { recursive: true });
process.env.TMPDIR = tmpRoot;
process.env.TMP = tmpRoot;
process.env.TEMP = tmpRoot;

