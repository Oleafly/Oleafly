import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import { PreviewCardStore } from "./PreviewCardStore.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";

/**
 * A handle to control a preview card imperatively and to associate detached triggers with it.
 */
export class PreviewCardHandle {
  /**
   * Internal store holding the preview card state.
   * @internal
   */

  constructor() {
    this.store = new PreviewCardStore();
  }

  /**
   * Opens the preview card and associates it with the trigger with the given ID.
   * The trigger must be a PreviewCard.Trigger component with this handle passed as a prop.
   *
   * This method should only be called in an event handler or an effect (not during rendering).
   *
   * @param triggerId ID of the trigger to associate with the preview card.
   */
  open(triggerId) {
    const triggerElement = triggerId ? this.store.context.triggerElements.getById(triggerId) : undefined;
    if (triggerId && !triggerElement) {
      throw new Error(process.env.NODE_ENV !== "production" ? `Base UI: PreviewCardHandle.open: No trigger found with id "${triggerId}".` : _formatErrorMessage(88, triggerId));
    }
    this.store.setOpen(true, createChangeEventDetails(REASONS.imperativeAction, undefined, triggerElement));
  }

  /**
   * Closes the preview card.
   */
  close() {
    this.store.setOpen(false, createChangeEventDetails(REASONS.imperativeAction, undefined, undefined));
  }

  /**
   * Indicates whether the preview card is currently open.
   */
  get isOpen() {
    return this.store.select('open');
  }
}

/**
 * Creates a new handle to connect a PreviewCard.Root with detached PreviewCard.Trigger components.
 */
export function createPreviewCardHandle() {
  return new PreviewCardHandle();
}