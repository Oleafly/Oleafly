function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import * as React from 'react';
import PickerPanel from "../../PickerPanel";
import { PickerHackContext } from "../../PickerPanel/context";
import PickerContext from "../context";
import { offsetPanelDate } from "../hooks/useRangePickerValue";
export default function PopupPanel(props) {
  const {
    picker,
    multiplePanel,
    pickerValue,
    onPickerValueChange,
    needConfirm,
    onSubmit,
    range,
    hoverValue
  } = props;
  const {
    prefixCls,
    generateConfig
  } = React.useContext(PickerContext);

  // ======================== Offset ========================
  const internalOffsetDate = React.useCallback((date, offset) => {
    return offsetPanelDate(generateConfig, picker, date, offset);
  }, [generateConfig, picker]);
  const nextPickerValue = React.useMemo(() => internalOffsetDate(pickerValue, 1), [pickerValue, internalOffsetDate]);

  // Outside
  const onSecondPickerValueChange = nextDate => {
    onPickerValueChange(internalOffsetDate(nextDate, -1));
  };

  // ======================= Context ========================
  const sharedContext = {
    onCellDblClick: () => {
      if (needConfirm) {
        onSubmit();
      }
    }
  };
  const hideHeader = picker === 'time';

  // ======================== Props =========================
  const pickerProps = {
    ...props,
    hoverValue: null,
    hoverRangeValue: null,
    hideHeader
  };
  if (range) {
    pickerProps.hoverRangeValue = hoverValue;
  } else {
    pickerProps.hoverValue = hoverValue;
  }

  // ======================== Render ========================
  // Multiple
  if (multiplePanel) {
    return /*#__PURE__*/React.createElement("div", {
      className: `${prefixCls}-panels`
    }, /*#__PURE__*/React.createElement(PickerHackContext.Provider, {
      value: {
        ...sharedContext,
        hideNext: true
      }
    }, /*#__PURE__*/React.createElement(PickerPanel, pickerProps)), /*#__PURE__*/React.createElement(PickerHackContext.Provider, {
      value: {
        ...sharedContext,
        hidePrev: true
      }
    }, /*#__PURE__*/React.createElement(PickerPanel, _extends({}, pickerProps, {
      pickerValue: nextPickerValue,
      onPickerValueChange: onSecondPickerValueChange
    }))));
  }

  // Single
  return /*#__PURE__*/React.createElement(PickerHackContext.Provider, {
    value: {
      ...sharedContext
    }
  }, /*#__PURE__*/React.createElement(PickerPanel, pickerProps));
}