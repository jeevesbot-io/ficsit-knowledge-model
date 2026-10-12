/**
 * The static site: every record gets a page, IRIs map to files, and every
 * internal link and anchor resolves.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadGameData } from '../src/graph.ts';
import { buildSite } from '../src/site.ts';

let dir: string;
let pageCount: number;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ficsit-site-'));
  pageCount = buildSite(dir, { copyDumps: false });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('static site', () => {
  it('writes one page per record, at /id/<class name>', () => {
    const data = loadGameData();
    const ids = [
      ...data.items,
      ...data.recipes,
      ...data.buildings,
      ...data.schematics,
      ...data.resourceNodes,
      ...data.collectibles,
      ...data.sources,
    ].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // IDs are unique across kinds
    expect(pageCount).toBe(ids.length);
    expect(readdirSync(join(dir, 'id'))).toHaveLength(ids.length);
    const plate = readFileSync(join(dir, 'id', 'Desc_IronPlate_C.html'), 'utf8');
    expect(plate).toContain(
      'https://solstice035.github.io/ficsit-knowledge-model/id/Desc_IronPlate_C',
    );
    expect(plate).toContain('href="Recipe_IronPlate_C.html"'); // made by
    expect(plate).toContain('Community-sourced'); // the caveat is on every page
  });

  it('has a vocab anchor for every term the RDF uses in the ficsit namespace', () => {
    const vocab = readFileSync(join(dir, 'vocab.html'), 'utf8');
    const context = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', 'model', 'generated', 'ficsit.context.jsonld'),
        'utf8',
      ),
    )['@context'] as Record<string, unknown>;
    const ficsitTerms = Object.entries(context)
      .filter(([, v]) => {
        const id = typeof v === 'string' ? v : (v as { '@id'?: string })['@id'];
        return id !== undefined && !id.includes(':') && !id.startsWith('@');
      })
      .map(([k]) => k);
    expect(ficsitTerms.length).toBeGreaterThan(50);
    const missing = ficsitTerms.filter((t) => !vocab.includes(`id="${t}"`));
    expect(missing).toEqual([]);
  });

  it('resolves every internal link and anchor', () => {
    const pages = [
      join(dir, 'index.html'),
      join(dir, 'vocab.html'),
      ...readdirSync(join(dir, 'id')).map((f) => join(dir, 'id', f)),
    ];
    const anchors = new Map<string, Set<string>>();
    const idsIn = (file: string) => {
      if (!anchors.has(file)) {
        const html = readFileSync(file, 'utf8');
        anchors.set(file, new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1] ?? '')));
      }
      return anchors.get(file) ?? new Set<string>();
    };
    const broken: string[] = [];
    for (const file of pages) {
      const html = readFileSync(file, 'utf8');
      for (const [, href = ''] of html.matchAll(/href="([^"]+)"/g)) {
        if (/^https?:/.test(href)) continue;
        const [path = '', anchor] = href.split('#');
        // Dumps are copied in by `npm run site` after `npm run build`.
        if (/(^|\/)(game\.(json|sqlite|ttl)|NOTICE\.md)$/.test(path)) continue;
        const target = path ? resolve(dirname(file), path) : file;
        if (!existsSync(target)) broken.push(`${file}: ${href}`);
        else if (anchor && !idsIn(target).has(anchor)) broken.push(`${file}: ${href}`);
      }
    }
    expect(broken.slice(0, 10)).toEqual([]);
  });
});
