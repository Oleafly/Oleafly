import React from 'react';
import { isPlainObject } from '../../_util/is';
const useSpinProps = loading => {
  const spinProps = React.useMemo(() => {
    if (typeof loading === 'boolean') {
      return {
        spinning: loading
      };
    }
    if (isPlainObject(loading)) {
      return {
        spinning: true,
        ...loading
      };
    }
    return {};
  }, [loading]);
  return spinProps;
};
export default useSpinProps;