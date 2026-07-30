import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { MenuStore } from "./MenuStore.mjs";
export class MenuHandle {
  /**
   * Internal store holding the menu's state.
   * @internal
   */

  constructor() {
    this.store = new MenuStore();
  }

  /**
   * Opens the menu and associates it with the trigger with the given id.
   * The trigger must be a Menu.Trigger component with this handle passed as a prop.
   *
   * @param triggerId ID of the trigger to associate with the menu.
   */
  open(triggerId) {
    const triggerElement = triggerId ? this.store.context.triggerElements.getById(triggerId) : undefined;
    if (triggerId && !triggerElement) {
      throw new Error(process.env.NODE_ENV !== "production" ? `Base UI: MenuHandle.open: No trigger found with id "${triggerId}".` : _formatErrorMessage(83, triggerId));
    }
    this.store.setOpen(true, createChangeEventDetails('imperative-action', undefined, triggerElement));
  }

  /**
   * Closes the menu.
   */
  close() {
    this.store.setOpen(false, createChangeEventDetails('imperative-action', undefined, undefined));
  }

  /**
   * Indicates whether the menu is currently open.
   */
  get isOpen() {
    return this.store.select('open');
  }
}

/**
 * Creates a new handle to connect a Menu.Root with detached Menu.Trigger components.
 */
export function createMenuHandle() {
  return new MenuHandle();
}