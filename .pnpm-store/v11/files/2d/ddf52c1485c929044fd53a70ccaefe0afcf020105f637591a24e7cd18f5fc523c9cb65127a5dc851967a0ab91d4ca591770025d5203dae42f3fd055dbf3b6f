"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.triggerStateAttributesMapping = void 0;
var _popupStateMapping = require("../../utils/popupStateMapping");
var _constants = require("../../internals/field-constants/constants");
const triggerStateAttributesMapping = exports.triggerStateAttributesMapping = {
  ..._popupStateMapping.pressableTriggerOpenStateMapping,
  ..._constants.fieldValidityMapping,
  popupSide: side => side ? {
    'data-popup-side': side
  } : null,
  listEmpty: empty => empty ? {
    'data-list-empty': ''
  } : null
};