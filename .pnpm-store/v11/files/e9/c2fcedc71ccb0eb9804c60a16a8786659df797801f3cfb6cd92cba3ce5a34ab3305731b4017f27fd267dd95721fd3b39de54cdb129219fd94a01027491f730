import { isValidElement } from 'react';
import { isPlainObject, isReactRenderable } from './is';
const convertToTooltipProps = (tooltip, context) => {
  if (!isReactRenderable(tooltip)) {
    return null;
  }
  if (isPlainObject(tooltip) && ! /*#__PURE__*/isValidElement(tooltip)) {
    return {
      ...context,
      ...tooltip
    };
  }
  return {
    ...context,
    title: tooltip
  };
};
export default convertToTooltipProps;