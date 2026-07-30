import { isValidElement, useMemo } from 'react';
import { isPlainObject } from '../../_util/is';
export function isPlaceholderConfig(placeholder) {
  return isPlainObject(placeholder) && ! /*#__PURE__*/isValidElement(placeholder);
}
export default function usePlaceholderConfig(placeholder) {
  return useMemo(() => {
    if (!placeholder || !isPlaceholderConfig(placeholder)) {
      return {};
    }
    if (typeof placeholder.progress === 'boolean') {
      return {
        progressConfig: placeholder.progress ? {} : undefined
      };
    }
    return {
      progressConfig: placeholder.progress
    };
  }, [placeholder]);
}