"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.accordionStateAttributesMapping = void 0;
var _collapsibleOpenStateMapping = require("../../utils/collapsibleOpenStateMapping");
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _AccordionItemDataAttributes = require("./AccordionItemDataAttributes");
const accordionStateAttributesMapping = exports.accordionStateAttributesMapping = {
  ..._collapsibleOpenStateMapping.collapsibleOpenStateMapping,
  index: value => {
    return Number.isInteger(value) ? {
      [_AccordionItemDataAttributes.AccordionItemDataAttributes.index]: String(value)
    } : null;
  },
  ..._stateAttributesMapping.transitionStatusMapping,
  value: () => null
};