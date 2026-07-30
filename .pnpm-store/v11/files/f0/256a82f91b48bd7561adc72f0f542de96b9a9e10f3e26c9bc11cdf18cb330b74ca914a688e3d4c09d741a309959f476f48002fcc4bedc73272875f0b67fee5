import * as React from 'react';
import { isPlainObject } from '../../_util/is';
const useStackConfig = (stackConfig, defaultStackConfig) => React.useMemo(() => {
  const mergedStackConfig = stackConfig ?? defaultStackConfig;
  if (!mergedStackConfig) {
    return false;
  }
  return {
    ...(isPlainObject(defaultStackConfig) ? defaultStackConfig : {}),
    ...(isPlainObject(mergedStackConfig) ? mergedStackConfig : {})
  };
}, [stackConfig, defaultStackConfig]);
export default useStackConfig;