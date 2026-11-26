import { useEffect, useState } from 'react';
import { watchShop, type Shop } from '../../adapters/store';

/** Live shop document. failed = the shop does not exist or could not be read. */
export function useShop(shopId: string | undefined): { shop: Shop | null; failed: boolean } {
  const [shop, setShop] = useState<Shop | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setShop(null);
    if (!shopId) { setFailed(true); return; }
    setFailed(false);
    return watchShop(shopId, (s) => { setShop(s); setFailed(s === null); }, () => { setShop(null); setFailed(true); });
  }, [shopId]);
  return { shop, failed };
}
