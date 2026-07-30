import { useRef, useState } from 'react';
import deepEqual from '@gilbarbara/deep-equal';

import { PlainObject } from './types';
import { useMemoizedValue } from './useMemoizedValue';
import { useUpdateEffect } from './useUpdateEffect';
import { isString } from './utils';

export type UseDataChangesResult<T> = {
  [K in keyof T]?: {
    from: any;
    to: any;
  };
};

export interface UseDataChangesOptions<T> {
  /**
   * Determines whether to use shallow or deep comparison when checking for changes.
   * - `'shallow'` (default) follows React's behavior and only checks for reference changes.
   * - `'deep'` performs a deep comparison to detect nested changes.
   */
  comparison?: 'shallow' | 'deep';
  /**
   * An optional name to include in the console log for easier debugging.
   */
  name?: string;
  /**
   * An array of specific keys to track changes for. If omitted, all keys are tracked.
   */
  only?: Array<keyof T>;
  /**
   * Suppresses console logging when changes are detected.
   *
   * Only needed if `onChange` is **not** used.
   */
  skipLog?: boolean;
}

export function useDataChanges<T extends PlainObject<any>>(
  data: T,
  nameOrOptions: string | UseDataChangesOptions<T> = {},
): UseDataChangesResult<T> | undefined {
  const previousData = useRef<T>(data);
  const [changes, setChanges] = useState<UseDataChangesResult<T> | undefined>(undefined);

  const {
    comparison = 'shallow',
    name,
    only,
    skipLog = false,
  } = useMemoizedValue(isString(nameOrOptions) ? { name: nameOrOptions } : nameOrOptions);

  useUpdateEffect(() => {
    // Determine which keys to check
    const keysToCheck =
      only ?? (Object.keys({ ...previousData.current, ...data }) as Array<keyof T>);
    const changesObject: UseDataChangesResult<T> = {};

    keysToCheck.forEach(key => {
      const hasChanged =
        comparison === 'deep'
          ? !deepEqual(previousData.current[key], data[key])
          : previousData.current[key] !== data[key];

      if (hasChanged) {
        changesObject[key] = {
          from: previousData.current[key],
          to: data[key],
        };
      }
    });

    const hasChanges = Object.keys(changesObject).length > 0;

    setChanges(hasChanges ? changesObject : undefined);

    if (hasChanges && !skipLog) {
      const nameToken = name ? `: ${name}` : '';

      // eslint-disable-next-line no-console
      console.log(`[data-changes${nameToken}]`, changesObject);
    }

    previousData.current = data;
  }, [name, data, only, comparison, skipLog]);

  return changes;
}
