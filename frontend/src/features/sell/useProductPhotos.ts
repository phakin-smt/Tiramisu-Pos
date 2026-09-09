import { useEffect, useMemo, useState } from 'react';

import { useConnectivity } from '../../connectivity/ConnectivityContext';
import { cacheProductImages, readProductImageObjectUrls } from '../../offline/productImages';
import type { CatalogProduct } from '../../types/products';

/**
 * The menu photos this till can draw, whether or not it has a network.
 *
 * The pictures are always drawn from what is stored rather than from the
 * server, so the sell screen looks the same online and off, and a till that
 * loses its connection mid-shift does not blink the photos out one by one.
 * When there is a connection the store is brought up to date first; when there
 * is not, whatever was last kept is what shows.
 */
export function useProductPhotos(
  storeId: number | null,
  products: readonly CatalogProduct[] | null,
): Map<number, string> {
  const { isOnline } = useConnectivity();
  const [photos, setPhotos] = useState<Map<number, string>>(() => new Map());

  // Re-reads only when a picture actually changes, not on every catalogue fetch:
  // the address carries a checksum, so identical addresses mean identical bytes.
  const signature = useMemo(
    () => (products ?? []).map((product) => `${product.id}:${product.imageUrl ?? ''}`).join('|'),
    [products],
  );

  useEffect(() => {
    if (storeId === null || !products) {
      setPhotos(new Map());
      return;
    }
    let current = true;
    let held: Map<number, string> | null = null;

    (async () => {
      if (isOnline) {
        // Fetching a photo is a nicety; failing to must never disturb the menu.
        try { await cacheProductImages(products, storeId); } catch { /* keep what we have */ }
      }
      if (!current) return;
      let loaded: Map<number, string>;
      try {
        loaded = await readProductImageObjectUrls(storeId);
      } catch {
        return;
      }
      if (!current) {
        loaded.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      held = loaded;
      setPhotos(loaded);
    })();

    return () => {
      current = false;
      held?.forEach((url) => URL.revokeObjectURL(url));
    };
    // products is covered by signature; depending on the array itself would
    // re-read on every catalogue fetch that changed nothing about the pictures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, signature, isOnline]);

  return photos;
}
