"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.itemMapping = void 0;
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _MenuCheckboxItemDataAttributes = require("../checkbox-item/MenuCheckboxItemDataAttributes");
const itemMapping = exports.itemMapping = {
  checked(value) {
    if (value) {
      return {
        [_MenuCheckboxItemDataAttributes.MenuCheckboxItemDataAttributes.checked]: ''
      };
    }
    return {
      [_MenuCheckboxItemDataAttributes.MenuCheckboxItemDataAttributes.unchecked]: ''
    };
  },
  ..._stateAttributesMapping.transitionStatusMapping
};