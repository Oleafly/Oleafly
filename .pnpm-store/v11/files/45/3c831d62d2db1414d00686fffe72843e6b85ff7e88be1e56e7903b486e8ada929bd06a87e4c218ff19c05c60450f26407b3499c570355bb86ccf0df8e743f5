"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.transitionStatusMapping = exports.TransitionStatusDataAttributes = void 0;
let TransitionStatusDataAttributes = exports.TransitionStatusDataAttributes = /*#__PURE__*/function (TransitionStatusDataAttributes) {
  /**
   * Present when the component is animating in.
   */
  TransitionStatusDataAttributes["startingStyle"] = "data-starting-style";
  /**
   * Present when the component is animating out.
   */
  TransitionStatusDataAttributes["endingStyle"] = "data-ending-style";
  return TransitionStatusDataAttributes;
}({});
const STARTING_HOOK = {
  [TransitionStatusDataAttributes.startingStyle]: ''
};
const ENDING_HOOK = {
  [TransitionStatusDataAttributes.endingStyle]: ''
};
const transitionStatusMapping = exports.transitionStatusMapping = {
  transitionStatus(value) {
    if (value === 'starting') {
      return STARTING_HOOK;
    }
    if (value === 'ending') {
      return ENDING_HOOK;
    }
    return null;
  }
};