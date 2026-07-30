import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { PopoverStore } from "./PopoverStore.mjs";
export class PopoverHandle {
  /**
   * Internal store holding the popover's state.
   * @internal
   */

  constructor() {
    this.store = new PopoverStore();
  }

  /**
   * Opens the popover and associates it with the trigger with the given id.
   * The trigger must be a Popover.Trigger component with this handle passed as a prop.
   *
   * @param triggerId ID of the trigger to associate with the popover.
   */
  open(triggerId) {
    const triggerElement = triggerId ? this.store.context.triggerElements.getById(triggerId) ?? undefined : undefined;
    if (triggerId && !triggerElement) {
      throw new Error(process.env.NODE_ENV !== "production" ? `Base UI: PopoverHandle.open: No trigger found with id "${triggerId}".` : _formatErrorMessage(80, triggerId));
    }
    this.store.setOpen(true, createChangeEventDetails(REASONS.imperativeAction, undefined, triggerElement));
  }

  /**
   * Closes the popover.
   */
  close() {
    this.store.setOpen(false, createChangeEventDetails(REASONS.imperativeAction, undefined, undefined));
  }

  /**
   * Indicates whether the popover is currently open.
   */
  get isOpen() {
    return this.store.select('open');
  }
}

/**
 * Creates a new handle to connect a Popover.Root with detached Popover.Trigger components.
 */
export function createPopoverHandle() {
  return new PopoverHandle();
}