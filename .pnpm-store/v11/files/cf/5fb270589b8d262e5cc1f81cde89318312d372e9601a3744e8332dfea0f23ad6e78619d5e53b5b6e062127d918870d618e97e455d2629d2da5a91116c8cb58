import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { canUseDOM, isString, off, on } from './utils';

interface UseScriptOptions {
  async?: boolean;
  defer?: boolean;
  id?: string;
  type?: string;
}

export type UseScriptResult = [loaded: boolean, error: boolean];

export function useScript(
  src: string,
  idOrOptions: string | UseScriptOptions = {},
): [loaded: boolean, error: boolean] {
  const options = useMemo(
    () => (isString(idOrOptions) ? { id: idOrOptions } : idOrOptions),
    [idOrOptions],
  );
  const script = useRef<HTMLScriptElement>(null);
  const [state, setState] = useState({
    loaded: false,
    error: false,
  });

  const onLoad = useCallback(() => {
    setState({
      loaded: true,
      error: false,
    });
  }, []);

  const onError = useCallback(() => {
    if (script.current) {
      script.current.remove();
    }

    setState({
      loaded: false,
      error: true,
    });
  }, []);

  useEffect(
    () => {
      if (!canUseDOM() || script.current) {
        return undefined;
      }

      const element = document.createElement('script');

      element.async = options.async ?? true;
      element.defer = options.defer ?? false;
      element.type = options.type || 'text/javascript';
      element.id = options.id || src;
      element.src = src;

      script.current = element;

      const { current } = script;

      on(current, 'load', onLoad);
      on(current, 'error', onError);

      // Add script to document body
      document.body.appendChild(current);

      return () => {
        off(current, 'load', onLoad);
        off(current, 'error', onError);
      };
    },
    [onError, onLoad, options, src], // Only re-run effect if script src changes
  );

  return [state.loaded, state.error];
}
