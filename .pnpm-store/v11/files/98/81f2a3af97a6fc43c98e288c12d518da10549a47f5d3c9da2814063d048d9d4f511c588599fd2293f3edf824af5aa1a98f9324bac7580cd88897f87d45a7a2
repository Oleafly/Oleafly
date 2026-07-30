"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MenuHandle = void 0;
exports.createMenuHandle = createMenuHandle;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _MenuStore = require("./MenuStore");
class MenuHandle {
  /**
   * Internal store holding the menu's state.
   * @internal
   */

  constructor() {
    this.store = new _MenuStore.MenuStore();
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
      throw new Error(process.env.NODE_ENV !== "production" ? `Base UI: MenuHandle.open: No trigger found with id "${triggerId}".` : (0, _formatErrorMessage2.default)(83, triggerId));
    }
    this.store.setOpen(true, (0, _createBaseUIEventDetails.createChangeEventDetails)('imperative-action', undefined, triggerElement));
  }

  /**
   * Closes the menu.
   */
  close() {
    this.store.setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)('imperative-action', undefined, undefined));
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
exports.MenuHandle = MenuHandle;
function createMenuHandle() {
  return new MenuHandle();
}