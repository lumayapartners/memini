import { readFileSync } from 'node:fs';

/** Single source of truth: the version shipped in package.json. */
export const VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
).version;
