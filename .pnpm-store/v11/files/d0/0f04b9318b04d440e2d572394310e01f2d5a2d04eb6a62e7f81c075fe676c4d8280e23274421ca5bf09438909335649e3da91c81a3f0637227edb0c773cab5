"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.alertDialogState = exports.AlertDialogHandle = void 0;
exports.createAlertDialogHandle = createAlertDialogHandle;
var _DialogHandle = require("../dialog/store/DialogHandle");
var _DialogStore = require("../dialog/store/DialogStore");
const alertDialogState = exports.alertDialogState = {
  modal: true,
  disablePointerDismissal: true,
  role: 'alertdialog'
};

/**
 * A handle to control an Alert Dialog imperatively and to associate detached triggers with it.
 */
class AlertDialogHandle extends _DialogHandle.DialogHandle {
  constructor(store) {
    const alertDialogStore = store ?? new _DialogStore.DialogStore(alertDialogState);
    super(alertDialogStore);
    if (store) {
      // Supplied stores may have been created as plain dialogs; enforce alert-dialog state.
      this.store.update(alertDialogState);
    }
  }
}

/**
 * Creates a new handle to connect an AlertDialog.Root with detached AlertDialog.Trigger components.
 */
exports.AlertDialogHandle = AlertDialogHandle;
function createAlertDialogHandle() {
  return new AlertDialogHandle();
}