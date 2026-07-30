import * as React from 'react';
export const SharedPanelContext = /*#__PURE__*/React.createContext(null);
/** Used for each single Panel. e.g. DatePanel */
export const PanelContext = /*#__PURE__*/React.createContext(null);
export function usePanelContext() {
  return React.useContext(PanelContext);
}

/**
 * Get shared props for the SharedPanelProps interface.
 */
export function useInfo(props, panelType) {
  // TODO: this is not good to get from each props.
  // Should move to `SharedPanelContext` instead.
  const {
    prefixCls,
    generateConfig,
    locale,
    disabledDate,
    minDate,
    maxDate,
    cellRender,
    hoverValue,
    hoverRangeValue,
    onHover,
    values,
    pickerValue,
    onSelect,
    // Icons
    prevIcon,
    nextIcon,
    superPrevIcon,
    superNextIcon
  } = props;

  // ======================= Context ========================
  const {
    classNames,
    styles
  } = React.useContext(SharedPanelContext);

  // ========================= MISC =========================
  const now = generateConfig.getNow();

  // ========================= Info =========================
  const info = {
    now,
    values,
    pickerValue,
    prefixCls,
    classNames,
    styles,
    disabledDate,
    minDate,
    maxDate,
    cellRender,
    hoverValue,
    hoverRangeValue,
    onHover,
    locale,
    generateConfig,
    onSelect,
    panelType,
    // Icons
    prevIcon,
    nextIcon,
    superPrevIcon,
    superNextIcon
  };
  return [info, now];
}

// ============================== Internal ==============================

/**
 * Internal usage for RangePicker to not to show the operation arrow
 */
export const PickerHackContext = /*#__PURE__*/React.createContext({});
if (process.env.NODE_ENV !== 'production') {
  PickerHackContext.displayName = 'PickerHackContext';
}