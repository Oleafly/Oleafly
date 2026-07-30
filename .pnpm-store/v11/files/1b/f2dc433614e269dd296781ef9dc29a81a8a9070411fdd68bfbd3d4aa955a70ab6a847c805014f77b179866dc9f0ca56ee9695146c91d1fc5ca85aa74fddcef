import { clsx } from 'clsx';
import * as React from 'react';
import useTimeInfo from "../../hooks/useTimeInfo";
import PickerContext from "../context";
export default function Footer(props) {
  const {
    mode,
    internalMode,
    renderExtraFooter,
    showNow,
    showTime,
    onSubmit,
    onNow,
    invalid,
    needConfirm,
    generateConfig,
    disabledDate
  } = props;
  const {
    prefixCls,
    locale,
    button: Button = 'button',
    classNames,
    styles
  } = React.useContext(PickerContext);

  // >>> Now
  const now = generateConfig.getNow();
  const [getValidTime] = useTimeInfo(generateConfig, showTime, now);

  // ======================== Extra =========================
  const extraNode = renderExtraFooter?.(mode);

  // ======================== Ranges ========================
  const nowDisabled = disabledDate(now, {
    type: mode
  });
  const onInternalNow = () => {
    if (!nowDisabled) {
      const validateNow = getValidTime(now);
      onNow(validateNow);
    }
  };
  const nowPrefixCls = `${prefixCls}-now`;
  const nowBtnPrefixCls = `${nowPrefixCls}-btn`;
  const presetNode = showNow && /*#__PURE__*/React.createElement("li", {
    className: nowPrefixCls
  }, /*#__PURE__*/React.createElement("a", {
    className: clsx(nowBtnPrefixCls, nowDisabled && `${nowBtnPrefixCls}-disabled`),
    "aria-disabled": nowDisabled,
    onClick: onInternalNow
  }, internalMode === 'date' ? locale.today : locale.now));

  // >>> OK
  const okNode = needConfirm && /*#__PURE__*/React.createElement("li", {
    className: `${prefixCls}-ok`
  }, /*#__PURE__*/React.createElement(Button, {
    disabled: invalid,
    onClick: onSubmit
  }, locale.ok));
  const rangeNode = (presetNode || okNode) && /*#__PURE__*/React.createElement("ul", {
    className: `${prefixCls}-ranges`
  }, presetNode, okNode);

  // ======================== Render ========================
  if (!extraNode && !rangeNode) {
    return null;
  }
  return /*#__PURE__*/React.createElement("div", {
    className: clsx(`${prefixCls}-footer`, classNames.popup.footer),
    style: styles.popup.footer
  }, extraNode && /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-footer-extra`
  }, extraNode), rangeNode);
}