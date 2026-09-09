/**
 * Keeping menu photos on the till.
 *
 * The service worker deliberately claims nothing under /api -- a route there
 * would have it reject every API call while offline, which is exactly the
 * signal the sync queue reads to tell "retry later" from "the server said no".
 * So the pictures are fetched and stored here instead, alongside the catalogue
 * snapshot they belong to, and read back as object URLs when the network is
 * gone.
 *
 * Nothing in here is allowed to break selling. A photo that will not download
 * leaves the menu showing its category emoji, which is what a menu without a
 * picture shows anyway.
 */

import { openPromttakPosDatabase, type ProductImageRecord } from './database';
import type { CatalogProduct } from '../types/products';

/** The checksum the server put in the picture's address. */
export function imageVersionFromUrl(url: string): string {
  const query = url.indexOf('?');
  if (query < 0) return '';
  return new URLSearchParams(url.slice(query + 1)).get('v') ?? '';
}

export async function readProductImages(storeId: number): Promise<ProductImageRecord[]> {
  const database = await openPromttakPosDatabase();
  try {
    return await database.getAllFromIndex('productImages', 'by-store', storeId);
  } finally {
    database.close();
  }
}

async function download(url: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) return null;
  return { bytes, contentType: response.headers.get('Content-Type') || 'image/webp' };
}

export interface CacheProductImagesResult {
  saved: number;
  removed: number;
  failed: number;
}

/**
 * Bring the stored photos in line with the catalogue that was just synced.
 *
 * Only what changed moves: a picture whose checksum already matches is left
 * alone, and one belonging to a menu that has lost its photo, or left the
 * catalogue, is dropped.
 */
export async function cacheProductImages(
  products: readonly CatalogProduct[],
  storeId: number,
): Promise<CacheProductImagesResult> {
  const wanted = new Map<number, { url: string; version: string }>();
  for (const product of products) {
    if (!product.imageUrl) continue;
    wanted.set(product.id, { url: product.imageUrl, version: imageVersionFromUrl(product.imageUrl) });
  }

  const held = new Map((await readProductImages(storeId)).map((record) => [record.productId, record]));
  const stale = [...held.keys()].filter((productId) => {
    const target = wanted.get(productId);
    return !target || target.version !== held.get(productId)?.version;
  });
  const missing = [...wanted.entries()].filter(([productId, target]) =>
    held.get(productId)?.version !== target.version);

  // Downloading before opening the write transaction: an IndexedDB transaction
  // closes itself the moment it goes a turn without work, and awaiting the
  // network inside one is the classic way to lose the write.
  const fetched: ProductImageRecord[] = [];
  let failed = 0;
  for (const [productId, target] of missing) {
    try {
      const payload = await download(target.url);
      if (!payload) { failed += 1; continue; }
      fetched.push({
        productId,
        storeId,
        version: target.version,
        contentType: payload.contentType,
        bytes: payload.bytes,
        savedAt: new Date().toISOString(),
      });
    } catch {
      // Offline, or the picture went away. The emoji stands in for it.
      failed += 1;
    }
  }

  if (!stale.length && !fetched.length) return { saved: 0, removed: 0, failed };

  const database = await openPromttakPosDatabase();
  try {
    const transaction = database.transaction('productImages', 'readwrite');
    const store = transaction.objectStore('productImages');
    await Promise.all([
      ...stale.map((productId) => store.delete(productId)),
      ...fetched.map((record) => store.put(record)),
      transaction.done,
    ]);
    return { saved: fetched.length, removed: stale.length, failed };
  } finally {
    database.close();
  }
}

/** Every photo this shop has on hand, as URLs an `<img>` can use offline. */
export async function readProductImageObjectUrls(storeId: number): Promise<Map<number, string>> {
  const records = await readProductImages(storeId);
  const urls = new Map<number, string>();
  for (const record of records) {
    urls.set(record.productId, URL.createObjectURL(new Blob([record.bytes], { type: record.contentType })));
  }
  return urls;
}
