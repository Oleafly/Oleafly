import * as React from 'react';
import { getRowFormat, toArray } from "../../utils/miscUtil";
export function useFieldFormat(picker, locale, format) {
  return React.useMemo(() => {
    const rawFormat = getRowFormat(picker, locale, format);
    const formatList = toArray(rawFormat);
    const firstFormat = formatList[0];
    const maskFormat = typeof firstFormat === 'object' && firstFormat.type === 'mask' ? firstFormat.format : null;
    return [
    // Format list
    formatList.map(config => typeof config === 'string' || typeof config === 'function' ? config : config.format),
    // Mask Format
    maskFormat];
  }, [picker, locale, format]);
}