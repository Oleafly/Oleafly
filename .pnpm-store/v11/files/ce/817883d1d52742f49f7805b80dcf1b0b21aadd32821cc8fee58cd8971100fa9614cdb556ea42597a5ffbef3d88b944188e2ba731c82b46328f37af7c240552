import { DialogStore } from "./DialogStore.mjs";
/**
 * A handle to control a Dialog imperatively and to associate detached triggers with it.
 */
export declare class DialogHandle<Payload> {
  /**
   * Internal store holding the dialog state.
   * @internal
   */
  readonly store: DialogStore<Payload>;
  constructor(store?: DialogStore<Payload>);
  /**
   * Opens the dialog and associates it with the trigger with the given id.
   * The trigger, if provided, must be a matching Trigger component with this handle passed as a prop.
   *
   * This method should only be called in an event handler or an effect (not during rendering).
   *
   * @param triggerId ID of the trigger to associate with the dialog. If null, the dialog will open without a trigger association.
   */
  open(triggerId: string | null): void;
  /**
   * Opens the dialog and sets the payload.
   * Does not associate the dialog with any trigger.
   *
   * @param payload Payload to set when opening the dialog.
   */
  openWithPayload(payload: Payload): void;
  /**
   * Closes the dialog.
   */
  close(): void;
  /**
   * Indicates whether the dialog is currently open.
   */
  get isOpen(): boolean;
}
/**
 * Creates a new handle to connect a Dialog.Root with detached Dialog.Trigger components.
 */
export declare function createDialogHandle<Payload>(): DialogHandle<Payload>;