import * as React from 'react';
import { warning } from '@rc-component/util';
export default function usePresets(presets, legacyRanges) {
  return React.useMemo(() => {
    if (presets) {
      return presets;
    }
    if (legacyRanges) {
      warning(false, '`ranges` is deprecated. Please use `presets` instead.');
      return Object.entries(legacyRanges).map(([label, value]) => ({
        label,
        value
      }));
    }
    return [];
  }, [presets, legacyRanges]);
}