function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import { clsx } from 'clsx';
import ResizeObserver from '@rc-component/resize-observer';
import * as React from 'react';
import { toArray } from "../../utils/miscUtil";
import PickerContext from "../context";
import Footer from "./Footer";
import PopupPanel from "./PopupPanel";
import PresetPanel from "./PresetPanel";
export default function Popup(props) {
  const {
    panelRender,
    internalMode,
    picker,
    showNow,
    // Range
    range,
    multiple,
    activeInfo = [0, 0, 0],
    // Presets
    presets,
    onPresetHover,
    onPresetSubmit,
    // Focus
    onFocus,
    onBlur,
    onPanelMouseDown,
    // Direction
    direction,
    // Change
    value,
    onSelect,
    isInvalid,
    defaultOpenValue,
    onOk,
    onSubmit,
    classNames,
    styles
  } = props;
  const {
    prefixCls
  } = React.useContext(PickerContext);
  const panelPrefixCls = `${prefixCls}-panel`;
  const rtl = direction === 'rtl';

  // ========================= Refs =========================
  const arrowRef = React.useRef(null);
  const wrapperRef = React.useRef(null);

  // ======================== Offset ========================
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [containerOffset, setContainerOffset] = React.useState(0);
  const [arrowOffset, setArrowOffset] = React.useState(0);
  const onResize = info => {
    if (info.width) {
      setContainerWidth(info.width);
    }
  };
  const [activeInputLeft, activeInputRight, selectorWidth] = activeInfo;
  const [retryTimes, setRetryTimes] = React.useState(0);
  React.useEffect(() => {
    setRetryTimes(10);
  }, [activeInputLeft]);
  React.useEffect(() => {
    // `activeOffset` is always align with the active input element
    // So we need only check container contains the `activeOffset`
    if (range && wrapperRef.current) {
      // Offset in case container has border radius
      const arrowWidth = arrowRef.current?.offsetWidth || 0;

      // Arrow Offset
      const wrapperRect = wrapperRef.current.getBoundingClientRect();
      if (!wrapperRect.height || wrapperRect.right < 0) {
        setRetryTimes(times => Math.max(0, times - 1));
        return;
      }
      const nextArrowOffset = (rtl ? activeInputRight - arrowWidth : activeInputLeft) - wrapperRect.left;
      setArrowOffset(nextArrowOffset);

      // Container Offset
      if (containerWidth && containerWidth < selectorWidth) {
        const offset = rtl ? wrapperRect.right - (activeInputRight - arrowWidth + containerWidth) : activeInputLeft + arrowWidth - wrapperRect.left - containerWidth;
        const safeOffset = Math.max(0, offset);
        setContainerOffset(safeOffset);
      } else {
        setContainerOffset(0);
      }
    }
  }, [retryTimes, rtl, containerWidth, activeInputLeft, activeInputRight, selectorWidth, range]);

  // ======================== Custom ========================
  function filterEmpty(list) {
    return list.filter(item => item);
  }
  const valueList = React.useMemo(() => filterEmpty(toArray(value)), [value]);
  const isTimePickerEmptyValue = picker === 'time' && !valueList.length;
  const footerSubmitValue = React.useMemo(() => {
    if (isTimePickerEmptyValue) {
      return filterEmpty([defaultOpenValue]);
    }
    return valueList;
  }, [isTimePickerEmptyValue, valueList, defaultOpenValue]);
  const popupPanelValue = isTimePickerEmptyValue ? defaultOpenValue : valueList;
  const disableSubmit = React.useMemo(() => {
    // Empty is invalid
    if (!footerSubmitValue.length) {
      return true;
    }
    return footerSubmitValue.some(val => isInvalid(val));
  }, [footerSubmitValue, isInvalid]);
  const onFooterSubmit = () => {
    // For TimePicker, we will additional trigger the value update
    if (isTimePickerEmptyValue) {
      onSelect(defaultOpenValue);
    }
    onOk();
    onSubmit();
  };
  let mergedNodes = /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-panel-layout`
  }, /*#__PURE__*/React.createElement(PresetPanel, {
    prefixCls: prefixCls,
    presets: presets,
    onClick: onPresetSubmit,
    onHover: onPresetHover
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PopupPanel, _extends({}, props, {
    value: popupPanelValue
  })), /*#__PURE__*/React.createElement(Footer, _extends({}, props, {
    showNow: multiple ? false : showNow,
    invalid: disableSubmit,
    onSubmit: onFooterSubmit
  }))));
  if (panelRender) {
    mergedNodes = panelRender(mergedNodes);
  }

  // ======================== Render ========================
  const containerPrefixCls = `${panelPrefixCls}-container`;
  const marginLeft = 'marginLeft';
  const marginRight = 'marginRight';

  // Container
  let renderNode = /*#__PURE__*/React.createElement("div", {
    onMouseDown: onPanelMouseDown,
    tabIndex: -1,
    className: clsx(containerPrefixCls,
    // Used for Today Button style, safe to remove if no need
    `${prefixCls}-${internalMode}-panel-container`, classNames?.popup?.container),
    style: {
      [rtl ? marginRight : marginLeft]: containerOffset,
      [rtl ? marginLeft : marginRight]: 'auto',
      ...styles?.popup?.container
    }
    // Still wish not to lose focus on mouse down
    // onMouseDown={(e) => {
    //   // e.preventDefault();
    // }}
    ,
    onFocus: onFocus,
    onBlur: onBlur
  }, mergedNodes);
  if (range) {
    renderNode = /*#__PURE__*/React.createElement("div", {
      onMouseDown: onPanelMouseDown,
      ref: wrapperRef,
      className: clsx(`${prefixCls}-range-wrapper`, `${prefixCls}-${picker}-range-wrapper`)
    }, /*#__PURE__*/React.createElement("div", {
      ref: arrowRef,
      className: `${prefixCls}-range-arrow`,
      style: {
        left: arrowOffset
      }
    }), /*#__PURE__*/React.createElement(ResizeObserver, {
      onResize: onResize
    }, renderNode));
  }
  return renderNode;
}