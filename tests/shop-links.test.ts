import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BANDS, SHOP_ONLY, shopAnchor, shopStrip } from '../scripts/build-landing-pages';
import { BEST_SELLERS, MIN_IN_STOCK, countInStock, fallbackLink, pickLink, shopUrl } from '../scripts/shop-links';
import { pickShopLink, shopUrl as builderShopUrl } from '../public/app/studio/shop.js';

const variants = [
  { id: 1, title: 'RANDOM BOY GROUP', available: true },
  { id: 2, title: 'RANDOM GIRL GROUP', available: true },
  { id: 3, title: 'BLACKPINK', available: true },
  { id: 4, title: 'BTS', available: false },
  { id: 5, title: '(G)-IDLE', available: true },
];
const product = (title: string, available: boolean) => ({ title, variants: [{ available: false }, { available }] });

describe('shop links: stock rules', () => {
  test('counts in-stock products, not mystery items', () => {
    expect(countInStock([product('Album A', true), product('Album B', false), product('Mystery Album', true)])).toBe(1);
  });

  test('a group with enough stock gets its collection', () => {
    expect(pickLink({ handle: 'aespa' }, /aespa/i, MIN_IN_STOCK, variants)).toEqual({ kind: 'group', path: '/collections/aespa' });
  });

  test('keeps the collection when the store could not be checked', () => {
    expect(pickLink({ handle: 'aespa' }, /aespa/i, null, variants).kind).toBe('group');
  });

  test('weak stock: the group\'s own mystery album, if in stock', () => {
    expect(pickLink({ handle: 'blackpink' }, /BLACKPINK/i, 2, variants).path).toBe('/products/mystery-kpop-album?variant=3');
    expect(pickLink({ handle: 'gi-dle', mystery: /\(G\)-?I-?DLE/i }, /\bi-dle\b/i, 0, variants).path).toBe('/products/mystery-kpop-album?variant=5');
  });

  test('weak stock, no own mystery album: the random boy or girl group one', () => {
    expect(pickLink({ handle: 'bts', boys: true }, /\bBTS\b/i, 0, variants).path).toBe('/products/mystery-kpop-album?variant=1');
    expect(pickLink({ handle: 'xg-1' }, /\bXG\b/, 0, variants).path).toBe('/products/mystery-kpop-album?variant=2');
  });

  test('nothing in stock at all: Best Sellers', () => {
    expect(pickLink({ handle: 'xg-1' }, /\bXG\b/, 0, [])).toEqual(BEST_SELLERS);
    expect(fallbackLink([])).toEqual(BEST_SELLERS);
    expect(fallbackLink(variants).kind).toBe('mystery');
  });

  test('every group page has a shop handle', () => {
    for (const b of [...BANDS, ...SHOP_ONLY]) expect(b.shop.handle).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('shop links: URLs and markup', () => {
  test('affiliate id and placement on every URL', () => {
    const url = new URL(shopUrl('/products/mystery-kpop-album?variant=2', 'landing'));
    expect(url.origin).toBe('https://www.kpop.exchange');
    expect(url.searchParams.get('variant')).toBe('2');
    expect(url.searchParams.get('aff')).toBe('206');
    expect(url.searchParams.get('utm_content')).toBe('landing');
    // The builder builds the same URL.
    expect(builderShopUrl(url.origin + '/products/mystery-kpop-album?variant=2', 'landing')).toBe(url.toString());
  });

  test('links open in a new tab, are marked sponsored and tracked', () => {
    const a = shopAnchor(BEST_SELLERS, 'footer', 'foot-link', 'Popular K-pop albums');
    expect(a).toContain('target="_blank"');
    expect(a).toContain('rel="sponsored noopener"');
    expect(a).toContain('data-aff="footer"');
    expect(a).toContain('affiliate link, opens in a new tab');
  });

  test('strips are hidden outside the region (.aff) and say "Affiliate link"', () => {
    const aespa = BANDS.find((b) => b.slug === 'aespa')!;
    const group = shopStrip({ kind: 'group', path: '/collections/aespa' }, 'landing', aespa);
    expect(group).toContain('class="shop-strip aff"');
    expect(group).toContain('Shop aespa');
    expect(group).toContain('Affiliate link');
    const mystery = shopStrip({ kind: 'mystery', path: '/products/mystery-kpop-album?variant=2' }, 'landing', aespa);
    expect(mystery).toContain('you get a random album');
    expect(mystery).not.toMatch(/\$\d|official/i);
  });
});

describe('builder: which link the ready card shows', () => {
  const data = {
    fallback: { kind: 'mystery', url: 'https://www.kpop.exchange/products/mystery-kpop-album' },
    groups: [
      { name: 'aespa', kind: 'group', url: 'https://www.kpop.exchange/collections/aespa', re: /aespa/i },
      { name: 'XG', kind: 'mystery', url: 'https://www.kpop.exchange/products/mystery-kpop-album?variant=2', re: /\bXG\b/ },
    ],
  };
  const songs = (n: number, group: string, other: number) => [
    ...Array.from({ length: n }, (_, i) => ({ group, title: `Song ${i}` })),
    ...Array.from({ length: other }, (_, i) => ({ group: 'Someone', title: `Other ${i}` })),
  ];

  test('one group is at least 40% and 3 songs: that group', () => {
    expect(pickShopLink(songs(4, 'aespa', 6), data)).toEqual({ kind: 'group', url: data.groups[0]!.url, group: 'aespa' });
  });

  test('matches on the title when the group is not set', () => {
    expect(pickShopLink([{ group: '', title: 'aespa - Whiplash' }, ...songs(2, 'aespa', 0)], data).group).toBe('aespa');
  });

  test('a mixed setlist, or too few songs: the mystery album', () => {
    expect(pickShopLink(songs(3, 'aespa', 6), data)).toEqual(data.fallback);
    expect(pickShopLink(songs(2, 'aespa', 0), data)).toEqual(data.fallback);
  });

  test('a weak-stock group keeps its own link (its mystery album)', () => {
    expect(pickShopLink(songs(5, 'XG', 1), data).url).toBe(data.groups[1]!.url);
  });
});

describe('shop region (US and Canada, by time zone)', () => {
  const src = readFileSync(join(import.meta.dir, '..', 'public', 'app', 'shop-region.js'), 'utf-8');
  new Function(src)();
  const inRegion = (globalThis as any).kpopInShopRegion as (z: unknown) => boolean;

  test.each(['America/New_York', 'America/Los_Angeles', 'America/Chicago', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'US/Eastern', 'Canada/Pacific'])(
    '%p is in',
    (z) => expect(inRegion(z)).toBe(true),
  );

  test.each(['Europe/London', 'Europe/Amsterdam', 'America/Mexico_City', 'America/Sao_Paulo', 'Asia/Seoul', '', undefined])(
    '%p is out',
    (z) => expect(inRegion(z)).toBe(false),
  );

  test('?shop-preview=on turns preview on and is remembered; =off turns it off', () => {
    const readPreview = (globalThis as any).kpopReadShopPreview as (s: string, st: unknown) => boolean;
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) };
    expect(readPreview('', storage)).toBe(false);
    expect(readPreview('?shop-preview=on', storage)).toBe(true);
    expect(readPreview('?mix=1', storage)).toBe(true);
    expect(readPreview('?a=1&shop-preview=off', storage)).toBe(false);
    expect(readPreview('?shop-preview=online', storage)).toBe(false);
  });

  test('preview still follows the URL when storage throws', () => {
    const readPreview = (globalThis as any).kpopReadShopPreview as (s: string, st: unknown) => boolean;
    const boom = () => { throw new Error('blocked'); };
    const storage = { getItem: boom, setItem: boom, removeItem: boom };
    expect(readPreview('?shop-preview=on', storage)).toBe(true);
    expect(readPreview('?shop-preview=off', storage)).toBe(false);
    expect(readPreview('', storage)).toBe(false);
  });
});
