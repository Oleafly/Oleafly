import { useEffect, useState } from 'react';

import { canUseDOM } from './utils';

export function useMediaQuery(input: string): boolean {
  const getMatches = (query: string): boolean => {
    if (!canUseDOM()) {
      return false;
    }

    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState<boolean>(getMatches(input));

  function handleChange() {
    setMatches(getMatches(input));
  }

  useEffect(() => {
    const matchMedia = window.matchMedia(input);

    // Triggered at the first client-side load and if query changes
    handleChange();

    try {
      matchMedia.addEventListener('change', handleChange);
    } catch {
      /* c8 ignore next 3 */
      // Safari isn't supporting matchMedia.addEventListener
      matchMedia.addListener(handleChange);
    }

    return () => {
      try {
        matchMedia.removeEventListener('change', handleChange);
      } catch {
        /* c8 ignore next 3 */
        // Safari isn't supporting matchMedia.removeEventListener
        matchMedia.removeListener(handleChange);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  return matches;
}
