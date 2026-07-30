"use client";

import React, { useMemo } from 'react';
import CloseCircleFilled from "@ant-design/icons/es/icons/CloseCircleFilled";
import fallbackProp from '../fallbackProp';
import { isPlainObject } from '../is';
import { devUseWarning } from '../warning';
export const useAllowClear = options => {
  const {
    allowClear,
    clearIcon,
    contextAllowClear,
    contextClearIcon,
    defaultAllowClear,
    componentName
  } = options;
  if (process.env.NODE_ENV !== 'production') {
    const warning = devUseWarning(componentName);
    warning.deprecated(!clearIcon, 'clearIcon', 'allowClear={{ clearIcon: React.ReactNode }}');
  }
  return useMemo(() => {
    const mergedAllowClear = allowClear ?? contextAllowClear ?? defaultAllowClear;
    if (!mergedAllowClear) {
      return false;
    }
    return {
      clearIcon: fallbackProp(isPlainObject(allowClear) ? allowClear?.clearIcon : clearIcon, isPlainObject(contextAllowClear) ? contextAllowClear?.clearIcon : contextClearIcon, /*#__PURE__*/React.createElement(CloseCircleFilled, null)),
      disabled: (isPlainObject(allowClear) ? allowClear?.disabled : undefined) ?? (isPlainObject(contextAllowClear) ? contextAllowClear?.disabled : undefined)
    };
  }, [allowClear, clearIcon, contextAllowClear, contextClearIcon, defaultAllowClear]);
};