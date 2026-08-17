import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';
function readMobile(): boolean { return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches; }

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(readMobile);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}
