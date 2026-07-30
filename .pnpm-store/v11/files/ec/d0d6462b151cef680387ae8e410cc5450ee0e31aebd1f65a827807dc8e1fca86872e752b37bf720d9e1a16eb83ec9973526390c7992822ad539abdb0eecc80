import { DialogStore } from "./DialogStore.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";

/**
 * A handle to control a Dialog imperatively and to associate detached triggers with it.
 */
export class DialogHandle {
  /**
   * Internal store holding the dialog state.
   * @internal
   */

  constructor(store) {
    this.store = store ?? new DialogStore();
  }

  /**
   * Opens the dialog and associates it with the trigger with the given id.
   * The trigger, if provided, must be a matching Trigger component with this handle passed as a prop.
   *
   * This method should only be called in an event handler or an effect (not during rendering).
   *
   * @param triggerId ID of the trigger to associate with the dialog. If null, the dialog will open without a trigger association.
   */
  open(triggerId) {
    const triggerElement = triggerId ? this.store.context.triggerElements.getById(triggerId) : undefined;
    if (process.env.NODE_ENV !== 'production') {
      if (triggerId && !triggerElement) {
        console.warn(`Base UI: DialogHandle.open: No trigger found with id "${triggerId}". The dialog will open, but the trigger will not be associated with the dialog.`);
      }
    }
    this.store.setOpen(true, createChangeEventDetails(REASONS.imperativeAction, undefined, triggerElement));
  }

  /**
   * Opens the dialog and sets the payload.
   * Does not associate the dialog with any trigger.
   *
   * @param payload Payload to set when opening the dialog.
   */
  openWithPayload(payload) {
    this.store.set('payload', payload);
    this.store.setOpen(true, createChangeEventDetails(REASONS.imperativeAction, undefined, undefined));
  }

  /**
   * Closes the dialog.
   */
  close() {
    this.store.setOpen(false, createChangeEventDetails(REASONS.imperativeAction, undefined, undefined));
  }

  /**
   * Indicates whether the dialog is currently open.
   */
  get isOpen() {
    return this.store.select('open');
  }
}

/**
 * Creates a new handle to connect a Dialog.Root with detached Dialog.Trigger components.
 */
export function createDialogHandle() {
  return new DialogHandle();
}