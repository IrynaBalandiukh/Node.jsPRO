import * as fs from 'node:fs';
import * as path from 'node:path';

export const CONSUMER_NAME = 'marketplace-web';
export const PROVIDER_NAME = 'marketplace-api';

// Walks up from this file to the repo root (the folder with package.json), so the
// path is right from test/contract (ts-node) and from dist-test/test/contract (js).
function findRoot(dir: string): string {
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('package.json not found above ' + __dirname);
    dir = parent;
  }
  return dir;
}

// <root>/pacts
export const PACTS_DIR = path.join(findRoot(__dirname), 'pacts');

// Consumer version to publish to the broker; in CI — the commit SHA.
export const CONSUMER_VERSION = process.env.CONSUMER_VERSION ?? '1.0.0';

// The provider version must match the prod tag in the broker (can-i-deploy).
export const PROVIDER_VERSION = process.env.PROVIDER_VERSION ?? '1.0.0';
