"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PreviewCardHandle = void 0;
exports.createPreviewCardHandle = createPreviewCardHandle;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var _PreviewCardStore = require("./PreviewCardStore");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
/**
 * A handle to control a preview card imperatively and to associate detached triggers with it.
 */
class PreviewCardHandle {
  /**
   * Internal store holding the preview card state.
   * @internal
   */

  constructor() {
    this.store = new _PreviewCardStore.PreviewCardStore();
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
      throw new Error(process.env.NODE_ENV !== "production" ? `Base UI: PreviewCardHandle.open: No trigger found with id "${triggerId}".` : (0, _formatErrorMessage2.default)(88, triggerId));
    }
    this.store.setOpen(true, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.imperativeAction, undefined, triggerElement));
  }

  /**
   * Closes the preview card.
   */
  close() {
    this.store.setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.imperativeAction, undefined, undefined));
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
exports.PreviewCardHandle = PreviewCardHandle;
function createPreviewCardHandle() {
  return new PreviewCardHandle();
}