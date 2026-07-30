"use strict";
"use client";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _form = require("@rc-component/form");
var _is = require("../_util/is");
var _warning = require("../_util/warning");
var _configProvider = require("../config-provider");
var _context = require("./context");
const FormList = ({
  prefixCls: customizePrefixCls,
  children,
  ...props
}) => {
  if (process.env.NODE_ENV !== 'production') {
    const warning = (0, _warning.useDevWarning)('Form.List');
    process.env.NODE_ENV !== "production" ? warning((0, _is.isNumber)(props.name) || (Array.isArray(props.name) ? !!props.name.length : !!props.name), 'usage', 'Miss `name` prop.') : void 0;
  }
  const {
    getPrefixCls
  } = React.useContext(_configProvider.ConfigContext);
  const prefixCls = getPrefixCls('form', customizePrefixCls);
  const contextValue = React.useMemo(() => ({
    prefixCls,
    status: 'error'
  }), [prefixCls]);
  return /*#__PURE__*/React.createElement(_form.List, {
    ...props
  }, (fields, operation, meta) => (/*#__PURE__*/React.createElement(_context.FormItemPrefixContext.Provider, {
    value: contextValue
  }, children(fields.map(field => ({
    ...field,
    fieldKey: field.key
  })), operation, {
    errors: meta.errors,
    warnings: meta.warnings
  }))));
};
var _default = exports.default = FormList;