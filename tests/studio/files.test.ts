/**
 * Checks on the new mix builder's files that would otherwise only show up as
 * a broken page in a browser.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { replaceBandLinks } from '../../scripts/build-landing-pages';

const ROOT = join(import.meta.dir, '..', '..', 'public');
const html = readFileSync(join(ROOT, 'studio.html'), 'utf-8');
const modules = readdirSync(join(ROOT, 'app', 'studio')).filter((f) => f.endsWith('.js'));

function importMap(): Record<string, string> {
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('studio.html has no import map');
  return JSON.parse(m[1]!).imports;
}

describe('studio.html', () => {
  test('pins every module to the same version in the import map', () => {
    const map = importMap();
    const versions = new Set<string>();
    for (const file of modules) {
      const key = `/app/studio/${file}`;
      expect(map[key]).toBeDefined();
      const v = map[key]!.match(/^\/app\/studio\/[\w-]+\.js\?v=(\d+)$/);
      expect(v).not.toBeNull();
      versions.add(v![1]!);
    }
    // No stale entries for files that are gone.
    expect(Object.keys(map).length).toBe(modules.length);
    expect(versions.size).toBe(1);
    const [v] = [...versions];
    expect(html).toContain(`<script type="module" src="/app/studio/main.js?v=${v}"></script>`);
  });

  test('modules import each other relatively, which the import map then pins', () => {
    // "./util.js" resolves to /app/studio/util.js, the map's key.
    for (const file of modules) {
      const src = readFileSync(join(ROOT, 'app', 'studio', file), 'utf-8');
      for (const m of src.matchAll(/^import .* from "([^"]+)";$/gm)) {
        expect(m[1]).toMatch(/^\.\/[\w-]+\.js$/);
        expect(modules).toContain(m[1]!.slice(2));
      }
    }
  });

  test('never puts text into the page as HTML', () => {
    for (const file of modules) {
      const src = readFileSync(join(ROOT, 'app', 'studio', file), 'utf-8');
      expect(src).not.toMatch(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/);
    }
  });

  test('stays out of search while it is a trial', () => {
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).not.toContain('rel="canonical"');
  });

  test('has one H1 and the group links between the build markers', () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    const links = html.slice(html.indexOf('<!-- BAND_LINKS:START -->'), html.indexOf('<!-- BAND_LINKS:END -->'));
    expect(links.match(/<a href="\/random-dance\/[a-z0-9-]+">/g)!.length).toBeGreaterThan(10);
  });

  test('every id the scripts look up exists in the page', () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const file of modules) {
      const src = readFileSync(join(ROOT, 'app', 'studio', file), 'utf-8');
      for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) expect(ids).toContain(m[1]);
    }
  });
});

describe('replaceBandLinks', () => {
  const page = 'before\n<!-- BAND_LINKS:START -->\n<a href="/random-dance/old">Old</a>\n<!-- BAND_LINKS:END -->\nafter';

  test('replaces only what is between the markers', () => {
    const out = replaceBandLinks(page, [
      { slug: 'bts', name: 'BTS' },
      { slug: 'g-i-dle', name: '(G)I-DLE & <friends>' },
    ])!;
    expect(out.startsWith('before\n<!-- BAND_LINKS:START -->')).toBe(true);
    expect(out.endsWith('<!-- BAND_LINKS:END -->\nafter')).toBe(true);
    expect(out).toContain('<a href="/random-dance/bts">BTS</a>');
    expect(out).toContain('(G)I-DLE &amp; &lt;friends&gt;');
    expect(out).not.toContain('/random-dance/old');
  });

  test('is null when the markers are missing', () => {
    expect(replaceBandLinks('no markers here', [])).toBeNull();
  });

  test('works on both real pages', () => {
    for (const name of ['index.html', 'studio.html']) {
      const real = readFileSync(join(ROOT, name), 'utf-8');
      const out = replaceBandLinks(real, [{ slug: 'bts', name: 'BTS' }])!;
      expect(out).not.toBeNull();
      const cut = (s: string) => [s.slice(0, s.indexOf('<!-- BAND_LINKS:START -->')), s.slice(s.indexOf('<!-- BAND_LINKS:END -->'))];
      expect(cut(out)).toEqual(cut(real));
    }
  });
});
