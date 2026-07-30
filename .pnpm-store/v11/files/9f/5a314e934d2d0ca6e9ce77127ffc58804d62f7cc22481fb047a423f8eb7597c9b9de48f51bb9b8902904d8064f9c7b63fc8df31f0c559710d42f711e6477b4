"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DialogRoot = DialogRoot;
var React = _interopRequireWildcard(require("react"));
var _DialogRootContext = require("./DialogRootContext");
var _useRenderDialogRoot = require("./useRenderDialogRoot");
/**
 * Groups all parts of the dialog.
 * Doesn't render its own HTML element.
 *
 * Documentation: [Base UI Dialog](https://base-ui.com/react/components/dialog)
 */
function DialogRoot(props) {
  const mode = React.useContext(_DialogRootContext.IsDrawerContext) ? 'drawer' : 'dialog';
  return (0, _useRenderDialogRoot.useRenderDialogRoot)(props, mode);
}