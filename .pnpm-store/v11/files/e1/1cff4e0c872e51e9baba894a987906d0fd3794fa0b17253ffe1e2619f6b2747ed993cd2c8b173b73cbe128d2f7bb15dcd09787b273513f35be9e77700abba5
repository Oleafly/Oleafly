"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TooltipHandle = void 0;
exports.createTooltipHandle = createTooltipHandle;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var _TooltipStore = require("./TooltipStore");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
/**
 * A handle to control a tooltip imperatively and to associate detached triggers with it.
 */
class TooltipHandle {
  /**
   * Internal store holding the tooltip state.
   * @internal
   */

  constructor() {
    this.store = new _TooltipStore.TooltipStore();
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
      throw new Error(process.env.NODE_ENV !== "production" ? `Base UI: TooltipHandle.open: No trigger found with id "${triggerId}".` : (0, _formatErrorMessage2.default)(81, triggerId));
    }
    this.store.setOpen(true, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.imperativeAction, undefined, triggerElement));
  }

  /**
   * Closes the tooltip.
   */
  close() {
    this.store.setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.imperativeAction, undefined, undefined));
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
exports.TooltipHandle = TooltipHandle;
function createTooltipHandle() {
  return new TooltipHandle();
}