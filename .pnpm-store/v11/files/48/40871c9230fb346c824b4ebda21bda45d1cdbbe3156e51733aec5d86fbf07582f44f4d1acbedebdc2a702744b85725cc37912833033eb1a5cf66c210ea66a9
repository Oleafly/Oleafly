"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PopoverHandle = void 0;
exports.createPopoverHandle = createPopoverHandle;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _PopoverStore = require("./PopoverStore");
class PopoverHandle {
  /**
   * Internal store holding the popover's state.
   * @internal
   */

  constructor() {
    this.store = new _PopoverStore.PopoverStore();
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
      throw new Error(process.env.NODE_ENV !== "production" ? `Base UI: PopoverHandle.open: No trigger found with id "${triggerId}".` : (0, _formatErrorMessage2.default)(80, triggerId));
    }
    this.store.setOpen(true, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.imperativeAction, undefined, triggerElement));
  }

  /**
   * Closes the popover.
   */
  close() {
    this.store.setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.imperativeAction, undefined, undefined));
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
exports.PopoverHandle = PopoverHandle;
function createPopoverHandle() {
  return new PopoverHandle();
}