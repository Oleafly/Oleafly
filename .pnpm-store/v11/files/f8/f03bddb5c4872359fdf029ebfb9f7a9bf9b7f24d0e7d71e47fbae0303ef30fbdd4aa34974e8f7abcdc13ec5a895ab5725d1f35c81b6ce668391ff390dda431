import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import { TooltipStore } from "./TooltipStore.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";

/**
 * A handle to control a tooltip imperatively and to associate detached triggers with it.
 */
export class TooltipHandle {
  /**
   * Internal store holding the tooltip state.
   * @internal
   */

  constructor() {
    this.store = new TooltipStore();
  }

  /**
   * Opens the tooltip and associates it with the trigger with the given ID.
   * The trigger must be a Tooltip.Trigger component with this handle passed as a prop.
   *
   * This method should only be called in an event handler or an effect (not during rendering).
   *
   * @param triggerId ID of the trigger to associate with the tooltip.
   */
  open(triggerId) {
    const triggerElement = triggerId ? this.store.context.triggerElements.getById(triggerId) : undefined;
    if (triggerId && !triggerElement) {
      throw new Error(process.env.NODE_ENV !== "production" ? `Base UI: TooltipHandle.open: No trigger found with id "${triggerId}".` : _formatErrorMessage(81, triggerId));
    }
    this.store.setOpen(true, createChangeEventDetails(REASONS.imperativeAction, undefined, triggerElement));
  }

  /**
   * Closes the tooltip.
   */
  close() {
    this.store.setOpen(false, createChangeEventDetails(REASONS.imperativeAction, undefined, undefined));
  }

  /**
   * Indicates whether the tooltip is currently open.
   */
  get isOpen() {
    return this.store.select('open');
  }
}

/**
 * Creates a new handle to connect a Tooltip.Root with detached Tooltip.Trigger components.
 */
export function createTooltipHandle() {
  return new TooltipHandle();
}