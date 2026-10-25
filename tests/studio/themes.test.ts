import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_THEME, THEMES, knownTheme, themeName } from '../../public/app/studio/themes.js';

const root = join(import.meta.dir, '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf-8');
const others = THEMES.map((t) => t.id).filter((id) => id !== DEFAULT_THEME);

describe('themes', () => {
  test('an unknown or missing id falls back to Dark', () => {
    expect(knownTheme('lemonade')).toBe('lemonade');
    expect(knownTheme('pink')).toBe('dark');
    expect(knownTheme(undefined)).toBe('dark');
    expect(themeName('thisthat')).toBe('THIS & THAT');
    expect(themeName('nope')).toBe('Dark');
  });

  test.each(['public/css/studio.css', 'public/css/landing.css'])('%s defines every theme and its menu swatch', (file) => {
    const css = read(file);
    for (const id of others) expect(css).toContain(`:root[data-theme='${id}'] {`);
    for (const t of THEMES) expect(css).toContain(`.theme-pill[data-pill='${t.id}']`);
  });

  test.each(['public/index.html', 'scripts/build-landing-pages.ts'])('%s applies exactly these themes before paint and lists them in the menu', (file) => {
    const src = read(file);
    const match = src.match(/\/\^\(([a-z|]+)\)\$\/\.test\(t\)/);
    expect(match).not.toBeNull();
    expect(match![1]!.split('|').sort()).toEqual([...others].sort());
    for (const t of THEMES) expect(src).toContain(`data-theme-choice="${t.id}"`);
  });
});
