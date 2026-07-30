import * as React from 'react';
const useDisabled = rawDisabled => {
  const isHandleDisabled = React.useCallback(index => {
    if (typeof rawDisabled === 'boolean') {
      return rawDisabled;
    }
    return rawDisabled[index] ?? false;
  }, [rawDisabled]);
  const getDisabledState = React.useCallback(rawValues => {
    if (typeof rawDisabled === 'boolean') {
      return [rawDisabled, rawDisabled && rawValues.length > 0];
    }
    return [rawValues.length > 0 && rawValues.every((_, index) => isHandleDisabled(index)), rawValues.some((_, index) => isHandleDisabled(index))];
  }, [rawDisabled, isHandleDisabled]);
  return React.useMemo(() => [isHandleDisabled, getDisabledState], [isHandleDisabled, getDisabledState]);
};
export default useDisabled;