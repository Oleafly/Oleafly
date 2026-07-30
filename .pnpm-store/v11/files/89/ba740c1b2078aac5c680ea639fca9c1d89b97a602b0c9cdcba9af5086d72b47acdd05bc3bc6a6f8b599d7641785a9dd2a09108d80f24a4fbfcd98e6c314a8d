import * as React from 'react';
export default function useCountExceed({
  countConfig,
  getTarget
}) {
  const [selection, setSelection] = React.useState(null);
  const getTargetRef = React.useRef(getTarget);
  React.useEffect(() => {
    getTargetRef.current = getTarget;
  }, [getTarget]);
  React.useEffect(() => {
    if (selection) {
      getTargetRef.current()?.setSelectionRange(...selection);
      setSelection(null);
    }
  }, [selection]);
  const getExceedValue = React.useCallback((currentValue, isComposing) => {
    let nextValue = currentValue;
    if (!isComposing && countConfig.exceedFormatter && countConfig.max && countConfig.strategy(currentValue) > countConfig.max) {
      nextValue = countConfig.exceedFormatter(currentValue, {
        max: countConfig.max
      });
      if (currentValue !== nextValue) {
        setSelection([getTargetRef.current()?.selectionStart || 0, getTargetRef.current()?.selectionEnd || 0]);
      }
    }
    return nextValue;
  }, [countConfig]);
  return getExceedValue;
}