"use strict";
"use client";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _classCallCheck2 = _interopRequireDefault(require("@babel/runtime/helpers/classCallCheck"));
var _createClass2 = _interopRequireDefault(require("@babel/runtime/helpers/createClass"));
var _callSuper2 = _interopRequireDefault(require("@babel/runtime/helpers/callSuper"));
var _inherits2 = _interopRequireDefault(require("@babel/runtime/helpers/inherits"));
var React = _interopRequireWildcard(require("react"));
var _is = require("../_util/is");
var _Alert = _interopRequireDefault(require("./Alert"));
let ErrorBoundary = /*#__PURE__*/function (_React$PureComponent) {
  function ErrorBoundary() {
    var _this;
    (0, _classCallCheck2.default)(this, ErrorBoundary);
    _this = (0, _callSuper2.default)(this, ErrorBoundary, arguments);
    _this.state = {
      error: undefined,
      info: {}
    };
    return _this;
  }
  (0, _inherits2.default)(ErrorBoundary, _React$PureComponent);
  return (0, _createClass2.default)(ErrorBoundary, [{
    key: "componentDidCatch",
    value: function componentDidCatch(error, info) {
      this.setState({
        error,
        info
      });
    }
  }, {
    key: "render",
    value: function render() {
      const {
        message,
        title,
        description,
        id,
        children
      } = this.props;
      const {
        error,
        info
      } = this.state;
      const mergedTitle = title ?? message;
      const componentStack = info?.componentStack || null;
      const errorMessage = (0, _is.isNonNullable)(mergedTitle) ? mergedTitle : error?.toString();
      const errorDescription = (0, _is.isNonNullable)(description) ? description : componentStack;
      if (error) {
        return /*#__PURE__*/React.createElement(_Alert.default, {
          id: id,
          type: "error",
          title: errorMessage,
          description: /*#__PURE__*/React.createElement("pre", {
            style: {
              fontSize: '0.9em',
              overflowX: 'auto'
            }
          }, errorDescription)
        });
      }
      return children;
    }
  }]);
}(React.PureComponent);
var _default = exports.default = ErrorBoundary;