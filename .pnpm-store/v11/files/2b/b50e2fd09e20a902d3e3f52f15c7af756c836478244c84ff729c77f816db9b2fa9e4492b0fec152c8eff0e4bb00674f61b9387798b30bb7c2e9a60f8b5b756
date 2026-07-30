"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.triggerOpenStateMapping = exports.collapsibleOpenStateMapping = void 0;
var _CollapsiblePanelDataAttributes = require("../collapsible/panel/CollapsiblePanelDataAttributes");
var _CollapsibleTriggerDataAttributes = require("../collapsible/trigger/CollapsibleTriggerDataAttributes");
const PANEL_OPEN_HOOK = {
  [_CollapsiblePanelDataAttributes.CollapsiblePanelDataAttributes.open]: ''
};
const PANEL_CLOSED_HOOK = {
  [_CollapsiblePanelDataAttributes.CollapsiblePanelDataAttributes.closed]: ''
};
const triggerOpenStateMapping = exports.triggerOpenStateMapping = {
  open(value) {
    if (value) {
      return {
        [_CollapsibleTriggerDataAttributes.CollapsibleTriggerDataAttributes.panelOpen]: ''
      };
    }
    return null;
  }
};
const collapsibleOpenStateMapping = exports.collapsibleOpenStateMapping = {
  open(value) {
    if (value) {
      return PANEL_OPEN_HOOK;
    }
    return PANEL_CLOSED_HOOK;
  }
};