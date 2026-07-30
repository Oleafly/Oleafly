"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.stateAttributesMapping = void 0;
var _constants = require("../internals/field-constants/constants");
var _SwitchRootDataAttributes = require("./root/SwitchRootDataAttributes");
const stateAttributesMapping = exports.stateAttributesMapping = {
  ..._constants.fieldValidityMapping,
  checked(value) {
    if (value) {
      return {
        [_SwitchRootDataAttributes.SwitchRootDataAttributes.checked]: ''
      };
    }
    return {
      [_SwitchRootDataAttributes.SwitchRootDataAttributes.unchecked]: ''
    };
  }
};