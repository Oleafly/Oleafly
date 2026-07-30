'use client';

import * as React from 'react';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
export function useValueChanged(value, onChange) {
  const valueRef = React.useRef(value);
  const onChangeCallback = useStableCallback(onChange);
  useIsoLayoutEffect(() => {
    if (valueRef.current === value) {
      return;
    }
    onChangeCallback(valueRef.current);
  }, [value, onChangeCallback]);
  useIsoLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);
}