import * as React from 'react';
function executeValue(value) {
  return typeof value === 'function' ? value() : value;
}
export default function PresetPanel(props) {
  const {
    prefixCls,
    presets,
    onClick,
    onHover
  } = props;
  if (!presets.length) {
    return null;
  }
  return /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-presets`
  }, /*#__PURE__*/React.createElement("ul", null, presets.map(({
    label,
    value
  }, index) => /*#__PURE__*/React.createElement("li", {
    key: index,
    onClick: () => {
      onClick(executeValue(value));
    },
    onMouseEnter: () => {
      onHover(executeValue(value));
    },
    onMouseLeave: () => {
      onHover(null);
    }
  }, label))));
}