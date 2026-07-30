import { useMemo } from 'react';
/**
 * Convert `classNames` & `styles` to a fully filled object
 */
export default function useSemantic(classNames, styles) {
  return useMemo(() => {
    const mergedClassNames = {
      ...classNames,
      popup: classNames?.popup || {}
    };
    const mergedStyles = {
      ...styles,
      popup: styles?.popup || {}
    };
    return [mergedClassNames, mergedStyles];
  }, [classNames, styles]);
}