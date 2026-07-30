import { useEffect, useMemo, useState } from 'react';

import { Target } from './types';
import { canUseDOM, getElement } from './utils';

interface UseIntersectionObserverOptions extends IntersectionObserverInit {
  /**
   * Delay the response update.
   */
  delay?: number;
  /**
   * Trigger the observer only once.
   */
  once?: boolean;
}

export function useIntersectionObserver<T extends Element>(
  target: Target<T>,
  options?: UseIntersectionObserverOptions,
) {
  const { delay = 0, once = false, root = null, rootMargin = '0%', threshold = 0 } = options || {};
  const [value, setValue] = useState<IntersectionObserverEntry>();

  const disabled = value?.isIntersecting && once;

  const observer = useMemo(() => {
    if (!canUseDOM()) {
      return {};
    }

    return new IntersectionObserver(
      ([entry]: IntersectionObserverEntry[]) => {
        if (delay) {
          setTimeout(() => setValue(entry), delay);

          return;
        }

        setValue(entry);
      },
      { threshold, root, rootMargin },
    );
  }, [delay, root, rootMargin, threshold]);

  useEffect(() => {
    if (!canUseDOM() || !(observer instanceof IntersectionObserver) || disabled) {
      return () => undefined;
    }

    const element = getElement(target);

    if (!element) {
      return () => undefined;
    }

    observer.observe(element);

    return () => observer.disconnect();
  }, [target, root, rootMargin, disabled, observer]);

  return value;
}
