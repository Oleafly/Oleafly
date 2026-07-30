import { useCallback, useEffect, useMemo, useState } from 'react';

import { canUseDOM, off, on } from './utils';

export type Breakpoints = Record<string, number>;

export type UseBreakpointOrientation = 'landscape' | 'portrait';

export interface UseBreakpointResult<T extends Breakpoints> {
  /**
   * Returns true if the screen size is between the specified breakpoints and matches the optional orientation.
   */
  between(min: keyof T, max: keyof T, andOrientation?: UseBreakpointOrientation): boolean;
  /**
   * Returns true if the screen size is less than or equal to the specified breakpoint and matches the optional orientation.
   */
  max(breakpoint: keyof T, andOrientation?: UseBreakpointOrientation): boolean;
  /**
   * Returns true if the screen size is greater than or equal to the specified breakpoint and matches the optional orientation.
   */
  min(breakpoint: keyof T, andOrientation?: UseBreakpointOrientation): boolean;
  /**
   * The current screen orientation, either portrait or landscape.
   */
  orientation: UseBreakpointOrientation;
  /**
   * The current active breakpoint, based on the defined breakpoints.
   */
  size: keyof T;
}

const defaultBreakpoints: Breakpoints = { xs: 0, sm: 400, md: 768, lg: 1024, xl: 1280 };

export function useBreakpoint<T extends Breakpoints>(
  customBreakpoints?: T,
  initialWidth = Infinity,
  initialHeight = Infinity,
): UseBreakpointResult<T> {
  const breakpoints = (customBreakpoints ?? defaultBreakpoints) as T;

  const sizes = useMemo(
    () => Object.entries(breakpoints).sort(([, aSize], [, bSize]) => bSize - aSize),
    [breakpoints],
  );

  // Ensure the smallest breakpoint is 0 and warn if it's not
  const smallestBreakpoint = sizes[sizes.length - 1];

  if (smallestBreakpoint[1] !== 0) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`The "${smallestBreakpoint[0]}" breakpoint should be 0`);
    }
  }

  const getScreen = useCallback((): UseBreakpointResult<T> => {
    const height = canUseDOM() ? window.innerHeight : initialHeight;
    const width = canUseDOM() ? window.innerWidth : initialWidth;
    const size = sizes.find(([, s]) => s <= width) || sizes[0];
    const orientation = width > height ? 'landscape' : 'portrait';

    return {
      between: (min, max, andOrientation) =>
        width >= breakpoints[min] &&
        width < breakpoints[max] &&
        (!andOrientation || andOrientation === orientation),
      min: (breakpoint, andOrientation) =>
        width >= breakpoints[breakpoint] && (!andOrientation || andOrientation === orientation),
      max: (breakpoint, andOrientation) =>
        width < breakpoints[breakpoint] && (!andOrientation || andOrientation === orientation),
      orientation,
      size: size[0] as keyof T,
    };
  }, [breakpoints, initialHeight, initialWidth, sizes]);

  const [screen, setScreen] = useState(getScreen);

  useEffect(() => {
    const onResize = () => {
      setScreen(previous => {
        const current = getScreen();

        return current.size !== previous.size || current.orientation !== previous.orientation
          ? current
          : previous;
      });
    };

    on(window, 'resize', onResize);

    return () => off(window, 'resize', onResize);
  }, [getScreen]);

  return screen;
}
