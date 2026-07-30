'use client';

import * as React from 'react';
import { valueToPercent } from "../../utils/valueToPercent.mjs";
import { useIsHydrating } from "../../utils/useIsHydrating.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useSliderRootContext } from "../root/SliderRootContext.mjs";
import { sliderStateAttributesMapping } from "../root/stateAttributesMapping.mjs";
function getInsetStyles(vertical, range, start, end, renderBeforeHydration, hydrating) {
  const visibility = start === undefined || range && end === undefined ? 'hidden' : undefined;
  const startEdge = vertical ? 'bottom' : 'insetInlineStart';
  const mainSide = vertical ? 'height' : 'width';
  const crossSide = vertical ? 'width' : 'height';
  const styles = {
    visibility: renderBeforeHydration && hydrating ? 'hidden' : visibility,
    position: vertical ? 'absolute' : 'relative',
    [crossSide]: 'inherit'
  };
  styles['--start-position'] = `${start ?? 0}%`;
  if (!range) {
    styles[startEdge] = 0;
    styles[mainSide] = 'var(--start-position)';
    return styles;
  }
  styles['--relative-size'] = `${(end ?? 0) - (start ?? 0)}%`;
  styles[startEdge] = 'var(--start-position)';
  styles[mainSide] = 'var(--relative-size)';
  return styles;
}
function getCenteredStyles(vertical, range, start, end) {
  const startEdge = vertical ? 'bottom' : 'insetInlineStart';
  const mainSide = vertical ? 'height' : 'width';
  const crossSide = vertical ? 'width' : 'height';
  const styles = {
    position: vertical ? 'absolute' : 'relative',
    [crossSide]: 'inherit'
  };
  if (!range) {
    styles[startEdge] = 0;
    styles[mainSide] = `${start}%`;
    return styles;
  }
  const size = end - start;
  styles[startEdge] = `${start}%`;
  styles[mainSide] = `${size}%`;
  return styles;
}

/**
 * Visualizes the current value of the slider.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Slider](https://base-ui.com/react/components/slider)
 */
export const SliderIndicator = /*#__PURE__*/React.forwardRef(function SliderIndicator(componentProps, forwardedRef) {
  const {
    render,
    className,
    style: styleProp,
    ...elementProps
  } = componentProps;
  const {
    indicatorPosition,
    inset,
    max,
    min,
    orientation,
    renderBeforeHydration,
    state,
    values
  } = useSliderRootContext();
  const isHydrating = useIsHydrating();
  const vertical = orientation === 'vertical';
  const range = values.length > 1;
  const style = inset ? getInsetStyles(vertical, range, indicatorPosition[0], indicatorPosition[1], renderBeforeHydration, isHydrating) : getCenteredStyles(vertical, range, valueToPercent(values[0], min, max), valueToPercent(values[values.length - 1], min, max));
  const element = useRenderElement('div', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      ['data-base-ui-slider-indicator']: renderBeforeHydration ? '' : undefined,
      style,
      suppressHydrationWarning: renderBeforeHydration || undefined
    }, elementProps],
    stateAttributesMapping: sliderStateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") SliderIndicator.displayName = "SliderIndicator";