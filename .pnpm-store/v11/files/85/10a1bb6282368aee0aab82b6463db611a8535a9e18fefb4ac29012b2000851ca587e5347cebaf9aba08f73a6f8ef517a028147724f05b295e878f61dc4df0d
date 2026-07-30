"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.warn = warn;
let set;
if (process.env.NODE_ENV !== 'production') {
  set = new Set();
}
function warn(...messages) {
  if (process.env.NODE_ENV !== 'production') {
    const messageKey = messages.join(' ');
    if (!set.has(messageKey)) {
      set.add(messageKey);
      console.warn(`Base UI: ${messageKey}`);
    }
  }
}