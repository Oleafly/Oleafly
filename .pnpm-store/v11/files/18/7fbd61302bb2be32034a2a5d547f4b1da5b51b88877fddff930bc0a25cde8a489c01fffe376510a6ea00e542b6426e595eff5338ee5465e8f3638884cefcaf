import { PopoverStore } from "./PopoverStore.js";
export declare class PopoverHandle<Payload> {
  /**
   * Internal store holding the popover's state.
   * @internal
   */
  readonly store: PopoverStore<Payload>;
  constructor();
  /**
   * Opens the popover and associates it with the trigger with the given id.
   * The trigger must be a Popover.Trigger component with this handle passed as a prop.
   *
   * @param triggerId ID of the trigger to associate with the popover.
   */
  open(triggerId: string): void;
  /**
   * Closes the popover.
   */
  close(): void;
  /**
   * Indicates whether the popover is currently open.
   */
  get isOpen(): boolean;
}
/**
 * Creates a new handle to connect a Popover.Root with detached Popover.Trigger components.
 */
export declare function createPopoverHandle<Payload>(): PopoverHandle<Payload>;