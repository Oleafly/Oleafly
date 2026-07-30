import {
  Dispatch,
  SetStateAction,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { canUseDOM, noop } from './utils';

export type UseLocalStorageOptions<TValue> =
  | {
      raw: true;
    }
  | {
      deserializer: (value: string) => TValue;
      raw: false;
      serializer: (value: TValue) => string;
    };

export type UseLocalStorageResult<TValue> = [
  value: TValue | undefined,
  setValue: Dispatch<SetStateAction<TValue | undefined>>,
  remove: () => void,
];

function useLocalStorageHook<TValue>(
  key: string,
  initialValue?: TValue,
  options?: UseLocalStorageOptions<TValue>,
): UseLocalStorageResult<TValue> {
  if (!key) {
    throw new Error('useLocalStorage: "key" is required');
  }

  const deserializer = useMemo(
    () => (options?.raw ? (value: any) => value : (options?.deserializer ?? JSON.parse)),
    [options],
  );
  const serializer = useMemo(
    () => (options?.raw ? String : (options?.serializer ?? JSON.stringify)),
    [options],
  );

  const initializer = useRef((k: string) => {
    try {
      const localStorageValue = localStorage.getItem(k);

      if (localStorageValue !== null) {
        return deserializer(localStorageValue);
      }

      initialValue && localStorage.setItem(k, serializer(initialValue));

      return initialValue;
      /* c8 ignore next 6 */
    } catch {
      // If user is in private mode or has storage restriction
      // localStorage can throw. JSON.parse and JSON.stringify
      // can throw, too.
      return initialValue;
    }
  });

  const [state, setState] = useState<TValue | undefined>(() => initializer.current(key));

  useLayoutEffect(() => setState(initializer.current(key)), [key]);

  const set: Dispatch<SetStateAction<TValue | undefined>> = useCallback(
    patch => {
      try {
        const newState = patch instanceof Function ? patch(state) : patch;

        if (typeof newState === 'undefined') {
          return;
        }

        let value: string;

        if (options) {
          if (options.raw) {
            value = typeof newState === 'string' ? newState : JSON.stringify(newState);
          } else if (options?.serializer) {
            value = options.serializer(newState);
          } else {
            value = JSON.stringify(newState);
          }
        } else {
          value = JSON.stringify(newState);
        }

        localStorage.setItem(key, value);
        setState(deserializer(value));
        /* c8 ignore next 4 */
      } catch {
        // If user is in private mode or has storage restriction
        // localStorage can throw. Also, JSON.stringify can throw.
      }
    },
    [deserializer, key, options, state],
  );

  const remove = useCallback(() => {
    try {
      localStorage.removeItem(key);
      setState(undefined);
      /* c8 ignore next 4 */
    } catch {
      // If user is in private mode or has storage restriction
      // localStorage can throw.
    }
  }, [key, setState]);

  return [state, set, remove];
}

function useLocalStorageSSR<TValue>(
  _key: string,
  initialValue?: TValue,
  _options?: UseLocalStorageOptions<TValue>,
): UseLocalStorageResult<TValue> {
  return [initialValue, noop, noop];
}

export const useLocalStorage = canUseDOM() ? useLocalStorageHook : useLocalStorageSSR;
