"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.stateAttributesMapping = void 0;
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _constants = require("../../internals/field-constants/constants");
var _RadioRootDataAttributes = require("../root/RadioRootDataAttributes");
const stateAttributesMapping = exports.stateAttributesMapping = {
  checked(value) {
    if (value) {
      return {
        [_RadioRootDataAttributes.RadioRootDataAttributes.checked]: ''
      };
    }
    return {
      [_RadioRootDataAttributes.RadioRootDataAttributes.unchecked]: ''
    };
  },
  ..._stateAttributesMapping.transitionStatusMapping,
  ..._constants.fieldValidityMapping
};