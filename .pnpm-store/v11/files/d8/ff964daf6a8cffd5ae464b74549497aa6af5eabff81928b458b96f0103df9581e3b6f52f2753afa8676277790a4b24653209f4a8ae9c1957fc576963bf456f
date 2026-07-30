"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PopupTriggerMap = void 0;
/**
 * Data structure to keep track of popup trigger elements by their IDs.
 * Uses both a set of Elements and a map of IDs to Elements for efficient lookups.
 */
class PopupTriggerMap {
  constructor() {
    this.elementsSet = new Set();
    this.idMap = new Map();
  }

  /**
   * Adds a trigger element with the given ID.
   *
   * Note: The provided element is assumed to not be registered under multiple IDs.
   */
  add(id, element) {
    const existingElement = this.idMap.get(id);
    if (existingElement === element) {
      return;
    }
    if (existingElement !== undefined) {
      // We assume that the same element won't be registered under multiple ids.
      // This is safe considering how useTriggerRegistration is implemented.
      this.elementsSet.delete(existingElement);
    }
    this.elementsSet.add(element);
    this.idMap.set(id, element);
    if (process.env.NODE_ENV !== 'production') {
      if (this.elementsSet.size !== this.idMap.size) {
        // TODO: fix mui/no-guarded-throw
        // eslint-disable-next-line mui/no-guarded-throw
        throw new Error('Base UI: A trigger element cannot be registered under multiple IDs in PopupTriggerMap.');
      }
    }
  }

  /**
   * Removes the trigger element with the given ID.
   */
  delete(id) {
    const element = this.idMap.get(id);
    if (element) {
      this.elementsSet.delete(element);
      this.idMap.delete(id);
    }
  }

  /**
   * Whether the given element is registered as a trigger.
   */
  hasElement(element) {
    return this.elementsSet.has(element);
  }

  /**
   * Whether there is a registered trigger element matching the given predicate.
   */
  hasMatchingElement(predicate) {
    for (const element of this.elementsSet) {
      if (predicate(element)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns the trigger element associated with the given ID, or undefined if no such element exists.
   */
  getById(id) {
    return this.idMap.get(id);
  }

  /**
   * Returns an iterable of all registered trigger entries, where each entry is a tuple of [id, element].
   */
  entries() {
    return this.idMap.entries();
  }

  /**
   * Returns an iterable of all registered trigger elements.
   */
  elements() {
    return this.elementsSet.values();
  }

  /**
   * Returns the number of registered trigger elements.
   */
  get size() {
    return this.idMap.size;
  }
}
exports.PopupTriggerMap = PopupTriggerMap;