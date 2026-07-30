"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.error = error;
exports.reset = reset;
let set;
if (process.env.NODE_ENV !== 'production') {
  set = new Set();
}
function error(...messages) {
  if (process.env.NODE_ENV !== 'production') {
    const messageKey = messages.join(' ');
    if (!set.has(messageKey)) {
      set.add(messageKey);
      console.error(`Base UI: ${messageKey}`);
    }
  }
}
function reset() {
  set?.clear();
}