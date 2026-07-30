"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isValidateOpenKey = isValidateOpenKey;
var _util = require("@rc-component/util");
/** keyCode Judgment function */
function isValidateOpenKey(currentKeyCode) {
  return (
    // Undefined for Edge bug:
    // https://github.com/ant-design/ant-design/issues/51292
    currentKeyCode &&
    // Other keys
    ![
    // System function button
    _util.KeyCode.ESC, _util.KeyCode.SHIFT, _util.KeyCode.BACKSPACE, _util.KeyCode.TAB, _util.KeyCode.WIN_KEY, _util.KeyCode.ALT, _util.KeyCode.META, _util.KeyCode.WIN_KEY_RIGHT, _util.KeyCode.CTRL, _util.KeyCode.SEMICOLON, _util.KeyCode.EQUALS, _util.KeyCode.CAPS_LOCK, _util.KeyCode.CONTEXT_MENU,
    // Arrow keys - should not trigger open when navigating in input
    _util.KeyCode.UP,
    // KeyCode.DOWN,
    _util.KeyCode.LEFT, _util.KeyCode.RIGHT,
    // F1-F12
    _util.KeyCode.F1, _util.KeyCode.F2, _util.KeyCode.F3, _util.KeyCode.F4, _util.KeyCode.F5, _util.KeyCode.F6, _util.KeyCode.F7, _util.KeyCode.F8, _util.KeyCode.F9, _util.KeyCode.F10, _util.KeyCode.F11, _util.KeyCode.F12].includes(currentKeyCode)
  );
}