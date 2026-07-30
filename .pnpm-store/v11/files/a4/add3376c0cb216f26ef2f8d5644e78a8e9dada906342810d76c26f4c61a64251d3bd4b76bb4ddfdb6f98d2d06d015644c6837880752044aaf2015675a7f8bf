'use client';

import * as React from 'react';
import { formatNumber } from "../../utils/formatNumber.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useSliderRootContext } from "../root/SliderRootContext.mjs";
import { sliderStateAttributesMapping } from "../root/stateAttributesMapping.mjs";
/**
 * Displays the current value of the slider as text.
 * Renders an `<output>` element.
 *
 * Documentation: [Base UI Slider](https://base-ui.com/react/components/slider)
 */
export const SliderValue = /*#__PURE__*/React.forwardRef(function SliderValue(componentProps, forwardedRef) {
  const {
    'aria-live': ariaLive = 'off',
    render,
    className,
    children,
    style,
    ...elementProps
  } = componentProps;
  const {
    thumbMap,
    state,
    values,
    formatOptionsRef,
    locale
  } = useSliderRootContext();
  let htmlFor = '';
  for (const thumbMetadata of thumbMap.values()) {
    if (thumbMetadata?.inputId) {
      htmlFor += `${thumbMetadata.inputId} `;
    }
  }
  const outputFor = htmlFor.trim() === '' ? undefined : htmlFor.trim();
  const formattedValues = React.useMemo(() => {
    const arr = [];
    for (let i = 0; i < values.length; i += 1) {
      arr.push(formatNumber(values[i], locale, formatOptionsRef.current ?? undefined));
    }
    return arr;
  }, [formatOptionsRef, locale, values]);
  const defaultDisplayValue = values.map((v, i) => formattedValues[i] || v).join(' – ');
  const element = useRenderElement('output', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      // off by default because it will keep announcing when the slider is being dragged
      // and also when the value is changing (but not yet committed)
      'aria-live': ariaLive,
      children: typeof children === 'function' ? children(formattedValues, values) : defaultDisplayValue,
      htmlFor: outputFor
    }, elementProps],
    stateAttributesMapping: sliderStateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") SliderValue.displayName = "SliderValue";