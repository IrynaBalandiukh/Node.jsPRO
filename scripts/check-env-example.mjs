import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { envSchema } from '../dist/config/env.schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envExamplePath = join(__dirname, '..', '.env.example');

const schemaKeys = new Set(Object.keys(envSchema.shape));

const exampleKeys = new Set(
  readFileSync(envExamplePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=')[0].trim()),
);

const missingInExample = [...schemaKeys].filter((key) => !exampleKeys.has(key));
const extraInExample = [...exampleKeys].filter((key) => !schemaKeys.has(key));

if (missingInExample.length > 0 || extraInExample.length > 0) {
  if (missingInExample.length > 0) {
    console.error(`.env.example is missing variables from the schema: ${missingInExample.join(', ')}`);
  }
  if (extraInExample.length > 0) {
    console.error(`.env.example has variables not present in the schema: ${extraInExample.join(', ')}`);
  }
  process.exit(1);
}

console.log(`.env.example is in sync with the schema (${schemaKeys.size} variables).`);
