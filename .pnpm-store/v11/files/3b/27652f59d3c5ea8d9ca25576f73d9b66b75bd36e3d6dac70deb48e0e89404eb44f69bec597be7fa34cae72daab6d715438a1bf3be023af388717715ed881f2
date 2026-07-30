import { useMemo } from 'react';
import { isPlainObject } from '../_util/is';
export default function useShowSizeChanger(showSizeChanger) {
  return useMemo(() => {
    if (typeof showSizeChanger === 'boolean') {
      return [showSizeChanger, {}];
    }
    if (isPlainObject(showSizeChanger)) {
      return [true, showSizeChanger];
    }
    return [undefined, undefined];
  }, [showSizeChanger]);
}