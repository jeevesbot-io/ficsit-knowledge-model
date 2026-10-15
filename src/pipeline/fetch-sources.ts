/**
 * Downloads pinned raw sources into `data/raw/` (git-ignored) and checks each
 * against the SHA-256 in the committed `data/sources.lock.json`, so a rebuild
 * uses exactly the bytes the data was generated from.
 *
 * Usage:
 *   npm run data:fetch                     # download and verify against the lock
 *   npm run data:fetch -- --update-lock    # after bumping a SHA: rewrite the lock
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCK_PATH, RAW_DIR, SOURCES } from './sources.ts';

interface LockEntry {
  url: string;
  sha256: string;
  bytes: number;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status} ${response.statusText}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const updateLock = process.argv.includes('--update-lock');
  const locked: Record<string, LockEntry> =
    !updateLock && existsSync(LOCK_PATH) ? JSON.parse(readFileSync(LOCK_PATH, 'utf8')) : {};
  mkdirSync(RAW_DIR, { recursive: true });
  const lock: Record<string, LockEntry> = {};
  const problems: string[] = [];

  for (const [key, source] of Object.entries(SOURCES)) {
    process.stdout.write(`↓ ${key.padEnd(12)} ${source.url}\n`);
    const body = await download(source.url);
    writeFileSync(join(RAW_DIR, source.file), body);
    const entry = {
      url: source.url,
      sha256: createHash('sha256').update(body).digest('hex'),
      bytes: body.byteLength,
    };
    lock[source.file] = entry;
    const expected = locked[source.file];
    if (updateLock) continue;
    if (!expected || expected.url !== source.url) {
      problems.push(`${source.file}: not in the lock for this URL (run with --update-lock)`);
    } else if (expected.sha256 !== entry.sha256) {
      problems.push(`${source.file}: SHA-256 ${entry.sha256} ≠ locked ${expected.sha256}`);
    }
  }

  if (updateLock) {
    writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
    process.stdout.write(`✓ ${Object.keys(lock).length} sources written; lock updated\n`);
  } else if (problems.length) {
    for (const p of problems) process.stdout.write(`  ✗ ${p}\n`);
    throw new Error(`${problems.length} source(s) don't match data/sources.lock.json`);
  } else {
    process.stdout.write(`✓ ${Object.keys(lock).length} sources written and match the lock\n`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
