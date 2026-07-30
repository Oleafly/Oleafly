"use strict";
"use client";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _is = require("../_util/is");
const StatisticNumber = props => {
  const {
    value,
    formatter,
    precision,
    decimalSeparator,
    groupSeparator = '',
    prefixCls,
    className,
    style
  } = props;
  let valueNode;
  if ((0, _is.isFunction)(formatter)) {
    // Customize formatter
    valueNode = formatter(value);
  } else {
    // Internal formatter
    const val = String(value);
    const cells = val.match(/^(-?)(\d*)(\.(\d+))?$/);
    // Process if illegal number
    if (!cells || val === '-') {
      valueNode = val;
    } else {
      const negative = cells[1];
      let int = cells[2] || '0';
      let decimal = cells[4] || '';
      int = int.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);
      if ((0, _is.isNumber)(precision)) {
        decimal = decimal.padEnd(precision, '0').slice(0, precision > 0 ? precision : 0);
      }
      if (decimal) {
        decimal = `${decimalSeparator}${decimal}`;
      }
      valueNode = [/*#__PURE__*/React.createElement("span", {
        key: "int",
        className: `${prefixCls}-content-value-int`
      }, negative, int), decimal && (/*#__PURE__*/React.createElement("span", {
        key: "decimal",
        className: `${prefixCls}-content-value-decimal`
      }, decimal))];
    }
  }
  return /*#__PURE__*/React.createElement("span", {
    className: className,
    style: style
  }, valueNode);
};
if (process.env.NODE_ENV !== 'production') {
  StatisticNumber.displayName = 'StatisticNumber';
}
var _default = exports.default = StatisticNumber;