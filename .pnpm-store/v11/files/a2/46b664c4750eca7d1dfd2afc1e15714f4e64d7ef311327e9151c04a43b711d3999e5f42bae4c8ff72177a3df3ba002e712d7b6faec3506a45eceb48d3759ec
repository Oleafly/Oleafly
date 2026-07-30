import { clsx } from 'clsx';
import Overflow from '@rc-component/overflow';
import * as React from 'react';
export default function MultipleDates(props) {
  const {
    prefixCls,
    value,
    onRemove,
    removeIcon = '×',
    formatDate,
    disabled,
    maxTagCount,
    tagRender,
    placeholder
  } = props;
  const selectorCls = `${prefixCls}-selector`;
  const selectionCls = `${prefixCls}-selection`;
  const overflowCls = `${selectionCls}-overflow`;

  // ========================= Item =========================
  function renderSelector(content, onClose) {
    return /*#__PURE__*/React.createElement("span", {
      className: clsx(`${selectionCls}-item`),
      title: typeof content === 'string' ? content : null
    }, /*#__PURE__*/React.createElement("span", {
      className: `${selectionCls}-item-content`
    }, content), !disabled && onClose && /*#__PURE__*/React.createElement("span", {
      onMouseDown: e => {
        e.preventDefault();
      },
      onClick: onClose,
      className: `${selectionCls}-item-remove`
    }, removeIcon));
  }
  function renderItem(date) {
    const displayLabel = formatDate(date);
    const closable = !disabled;
    const onClose = event => {
      if (event) event.stopPropagation();
      if (!disabled) {
        onRemove(date);
      }
    };
    if (tagRender) {
      return tagRender({
        label: displayLabel,
        value: date,
        disabled: !!disabled,
        closable,
        onClose
      });
    }
    return renderSelector(displayLabel, onClose);
  }

  // ========================= Rest =========================
  function renderRest(omittedValues) {
    const content = `+ ${omittedValues.length} ...`;
    return renderSelector(content);
  }

  // ======================== Render ========================

  return /*#__PURE__*/React.createElement("div", {
    className: selectorCls
  }, /*#__PURE__*/React.createElement(Overflow, {
    prefixCls: overflowCls,
    data: value,
    renderItem: renderItem,
    renderRest: renderRest
    // suffix={inputNode}
    ,
    itemKey: date => formatDate(date),
    maxCount: maxTagCount
  }), !value.length && /*#__PURE__*/React.createElement("span", {
    className: `${prefixCls}-selection-placeholder`
  }, placeholder));
}