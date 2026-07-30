import { TooltipStore } from "./TooltipStore.js";
/**
 * A handle to control a tooltip imperatively and to associate detached triggers with it.
 */
export declare class TooltipHandle<Payload> {
  /**
   * Internal store holding the tooltip state.
   * @internal
   */
  readonly store: TooltipStore<Payload>;
  constructor();
  /**
   * Opens the tooltip and associates it with the trigger with the given ID.
   * The trigger must be a Tooltip.Trigger component with this handle passed as a prop.
   *
   * This method should only be called in an event handler or an effect (not during rendering).
   *
   * @param triggerId ID of the trigger to associate with the tooltip.
   */
  open(triggerId: string): void;
  /**
   * Closes the tooltip.
   */
  close(): void;
  /**
   * Indicates whether the tooltip is currently open.
   */
  get isOpen(): boolean;
}
/**
 * Creates a new handle to connect a Tooltip.Root with detached Tooltip.Trigger components.
 */
export declare function createTooltipHandle<Payload>(): TooltipHandle<Payload>;