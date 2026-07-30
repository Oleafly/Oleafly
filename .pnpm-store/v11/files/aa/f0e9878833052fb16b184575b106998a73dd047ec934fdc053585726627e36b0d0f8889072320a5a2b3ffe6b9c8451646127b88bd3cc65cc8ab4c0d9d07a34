import { PreviewCardStore } from "./PreviewCardStore.js";
/**
 * A handle to control a preview card imperatively and to associate detached triggers with it.
 */
export declare class PreviewCardHandle<Payload> {
  /**
   * Internal store holding the preview card state.
   * @internal
   */
  readonly store: PreviewCardStore<Payload>;
  constructor();
  /**
   * Opens the preview card and associates it with the trigger with the given ID.
   * The trigger must be a PreviewCard.Trigger component with this handle passed as a prop.
   *
   * This method should only be called in an event handler or an effect (not during rendering).
   *
   * @param triggerId ID of the trigger to associate with the preview card.
   */
  open(triggerId: string): void;
  /**
   * Closes the preview card.
   */
  close(): void;
  /**
   * Indicates whether the preview card is currently open.
   */
  get isOpen(): boolean;
}
/**
 * Creates a new handle to connect a PreviewCard.Root with detached PreviewCard.Trigger components.
 */
export declare function createPreviewCardHandle<Payload>(): PreviewCardHandle<Payload>;