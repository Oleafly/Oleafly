import React from 'react';
import { isFunction, isString } from '../../_util/is';
import SizeContext from '../SizeContext';
const useSize = customSize => {
  const size = React.useContext(SizeContext);
  const mergedSize = React.useMemo(() => {
    if (!customSize) {
      return size;
    }
    if (isString(customSize)) {
      return customSize ?? size;
    }
    if (isFunction(customSize)) {
      return customSize(size);
    }
    return size;
  }, [customSize, size]);
  return mergedSize;
};
export default useSize;