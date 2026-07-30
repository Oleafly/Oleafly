import { MenuStore } from "./MenuStore.js";
export declare class MenuHandle<Payload> {
  /**
   * Internal store holding the menu's state.
   * @internal
   */
  readonly store: MenuStore<Payload>;
  constructor();
  /**
   * Opens the menu and associates it with the trigger with the given id.
   * The trigger must be a Menu.Trigger component with this handle passed as a prop.
   *
   * @param triggerId ID of the trigger to associate with the menu.
   */
  open(triggerId: string): void;
  /**
   * Closes the menu.
   */
  close(): void;
  /**
   * Indicates whether the menu is currently open.
   */
  get isOpen(): boolean;
}
/**
 * Creates a new handle to connect a Menu.Root with detached Menu.Trigger components.
 */
export declare function createMenuHandle<Payload>(): MenuHandle<Payload>;