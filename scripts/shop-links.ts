/**
 * Shop links (kpop.exchange) for the group pages and the builder's ready card.
 *
 * A group gets its own collection only when that collection has enough in
 * stock; otherwise its own mystery album, then the random girl / boy group
 * mystery album, then Best Sellers. Stock is checked once, when the pages are
 * built (bun run build:pages), never live on the site.
 *
 * The links are only shown to visitors in the US and Canada: see
 * public/app/shop-region.js.
 */

export const SHOP_ORIGIN = 'https://www.kpop.exchange';
export const AFF_ID = '206';
const MYSTERY_HANDLE = 'mystery-kpop-album';

/** A collection needs this many in-stock items (mystery items not counted). */
export const MIN_IN_STOCK = 5;

export interface ShopDef {
  /** kpop.exchange collection handle: /collections/<handle>. */
  handle: string;
  boys?: boolean;
  /** The group's variant of the mystery album, when its name doesn't match the group's regex. */
  mystery?: RegExp;
}

export type LinkKind = 'group' | 'mystery' | 'bestsellers';

export interface ShopLink {
  kind: LinkKind;
  /** Path on kpop.exchange, without the affiliate parameter. */
  path: string;
}

export const BEST_SELLERS: ShopLink = { kind: 'bestsellers', path: '/collections/best-sellers' };

/** The affiliate URL, tagged with where on our site it was shown. */
export function shopUrl(path: string, placement: string): string {
  const url = new URL(path, SHOP_ORIGIN);
  url.searchParams.set('aff', AFF_ID);
  url.searchParams.set('utm_source', 'kpopgenerator');
  url.searchParams.set('utm_medium', 'affiliate');
  url.searchParams.set('utm_content', placement);
  return url.toString();
}

interface Variant {
  id: number;
  title: string;
  available: boolean;
}

interface Product {
  title: string;
  variants: { available?: boolean }[];
}

export function countInStock(products: Product[]): number {
  return products.filter((p) => !/mystery/i.test(p.title) && p.variants.some((v) => v.available)).length;
}

const mysteryPath = (v: Variant) => `/products/${MYSTERY_HANDLE}?variant=${v.id}`;

/**
 * The link for one group. inStock is null when the collection couldn't be
 * checked (network trouble): keep the collection rather than guess.
 */
export function pickLink(
  shop: ShopDef,
  match: RegExp,
  inStock: number | null,
  variants: Variant[],
): ShopLink {
  if (inStock === null || inStock >= MIN_IN_STOCK) return { kind: 'group', path: `/collections/${shop.handle}` };
  const own = variants.find((v) => v.available && (shop.mystery ?? match).test(v.title));
  if (own) return { kind: 'mystery', path: mysteryPath(own) };
  const random = variants.find((v) => v.available && v.title === (shop.boys ? 'RANDOM BOY GROUP' : 'RANDOM GIRL GROUP'));
  if (random) return { kind: 'mystery', path: mysteryPath(random) };
  return BEST_SELLERS;
}

/** The link when no group stands out: the mystery album page (any group), or Best Sellers. */
export function fallbackLink(variants: Variant[]): ShopLink {
  return variants.some((v) => v.available) ? { kind: 'mystery', path: `/products/${MYSTERY_HANDLE}` } : BEST_SELLERS;
}

async function getJson(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(new URL(path, SHOP_ORIGIN), { signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: res.ok ? await res.json() : null };
}

/** In-stock count, or null when the store couldn't be reached. A missing collection counts as 0. */
async function collectionStock(handle: string): Promise<number | null> {
  try {
    const products: Product[] = [];
    for (let page = 1; page <= 10; page++) {
      const { status, body } = await getJson(`/collections/${handle}/products.json?limit=250&page=${page}`);
      if (status === 404) {
        console.warn(`  ! shop: collection "${handle}" not found`);
        return 0;
      }
      if (!body) throw new Error(`HTTP ${status}`);
      products.push(...body.products);
      if (body.products.length < 250) break;
    }
    return countInStock(products);
  } catch (error) {
    console.warn(`  ! shop: couldn't check "${handle}" (${(error as Error).message}), keeping the collection link`);
    return null;
  }
}

async function mysteryVariants(): Promise<Variant[]> {
  try {
    const { status, body } = await getJson(`/products/${MYSTERY_HANDLE}.js`);
    if (!body) throw new Error(`HTTP ${status}`);
    return body.variants;
  } catch (error) {
    console.warn(`  ! shop: couldn't check the mystery album (${(error as Error).message})`);
    return [];
  }
}

export interface ShopGroup {
  name: string;
  match: RegExp;
  shop: ShopDef;
}

/** Checks the store and returns each group's link, plus the fallback. */
export async function resolveShopLinks(groups: ShopGroup[]): Promise<{ links: Map<string, ShopLink>; fallback: ShopLink }> {
  const variants = await mysteryVariants();
  const links = new Map<string, ShopLink>();
  for (const g of groups) {
    const link = pickLink(g.shop, g.match, await collectionStock(g.shop.handle), variants);
    links.set(g.name, link);
  }
  return { links, fallback: fallbackLink(variants) };
}

/** What the builder loads (public/app/shop-links.json). */
export function builderData(groups: ShopGroup[], links: Map<string, ShopLink>, fallback: ShopLink): object {
  return {
    note: 'Generated by scripts/build-landing-pages.ts. Do not edit.',
    fallback: { kind: fallback.kind, url: new URL(fallback.path, SHOP_ORIGIN).toString() },
    groups: groups.map((g) => {
      const link = links.get(g.name)!;
      return { name: g.name, match: g.match.source, flags: g.match.flags, kind: link.kind, url: new URL(link.path, SHOP_ORIGIN).toString() };
    }),
  };
}
