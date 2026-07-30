import * as React from 'react';
import { isPlainObject } from '../../_util/is';
const useMergedConfig = (propConfig, templateConfig) => {
  const support = Boolean(propConfig);
  return React.useMemo(() => {
    const config = {
      ...templateConfig,
      ...(support && isPlainObject(propConfig) ? propConfig : null)
    };
    return [support, config];
  }, [support, propConfig, templateConfig]);
};
export default useMergedConfig;