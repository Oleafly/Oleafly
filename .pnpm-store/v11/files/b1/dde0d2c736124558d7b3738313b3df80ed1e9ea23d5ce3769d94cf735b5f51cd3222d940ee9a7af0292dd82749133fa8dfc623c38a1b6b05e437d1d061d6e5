import { DialogHandle } from "../dialog/store/DialogHandle.mjs";
import { DialogStore } from "../dialog/store/DialogStore.mjs";
export declare const alertDialogState: {
  readonly modal: true;
  readonly disablePointerDismissal: true;
  readonly role: 'alertdialog';
};
/**
 * A handle to control an Alert Dialog imperatively and to associate detached triggers with it.
 */
export declare class AlertDialogHandle<Payload> extends DialogHandle<Payload> {
  private readonly __alertDialogBrand;
  constructor(store?: DialogStore<Payload>);
}
/**
 * Creates a new handle to connect an AlertDialog.Root with detached AlertDialog.Trigger components.
 */
export declare function createAlertDialogHandle<Payload>(): AlertDialogHandle<Payload>;