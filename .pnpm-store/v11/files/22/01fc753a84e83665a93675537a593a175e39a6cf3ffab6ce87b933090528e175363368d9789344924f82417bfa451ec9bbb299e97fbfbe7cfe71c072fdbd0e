type Listener<T> = (state: T) => void;
/**
 * A data store implementation that allows subscribing to state changes and updating the state.
 * It uses an observer pattern to notify subscribers when the state changes.
 */
export declare class Store<State> {
  /**
   * The current state of the store.
   * This property is updated immediately when the state changes as a result of calling {@link setState}, {@link update}, or {@link set}.
   * To subscribe to state changes, use the {@link useState} method. The value returned by {@link useState} is updated after the component renders (similarly to React's useState).
   * The values can be used directly (to avoid subscribing to the store) in effects or event handlers.
   *
   * Do not modify properties in state directly. Instead, use the provided methods to ensure proper state management and listener notification.
   */
  state: State;
  private listeners;
  private updateTick;
  constructor(state: State);
  /**
   * Registers a listener that will be called whenever the store's state changes.
   *
   * @param fn The listener function to be called on state changes.
   * @returns A function to unsubscribe the listener.
   */
  subscribe: (fn: Listener<State>) => () => void;
  /**
   * Returns the current state of the store.
   */
  getSnapshot: () => State;
  /**
   * Updates the entire store's state and notifies all registered listeners.
   *
   * @param newState The new state to set for the store.
   */
  setState(newState: State): void;
  /**
   * Merges the provided changes into the current state and notifies listeners if there are changes.
   *
   * @param changes An object containing the changes to apply to the current state.
   */
  update(changes: Partial<State>): void;
  /**
   * Sets a specific key in the store's state to a new value and notifies listeners if the value has changed.
   *
   * @param key The key in the store's state to update.
   * @param value The new value to set for the specified key.
   */
  set<T>(key: keyof State, value: T): void;
  /**
   * Gives the state a new reference and updates all registered listeners.
   */
  notifyAll(): void;
  use<F extends (...args: any) => any>(selector: F, ...args: SelectorArgs<F>): ReturnType<F>;
}
export type ReadonlyStore<State> = Pick<Store<State>, 'getSnapshot' | 'subscribe' | 'state'>;
type SelectorArgs<Selector> = Selector extends ((...params: infer Params) => any) ? Tail<Params> : never;
type Tail<T extends readonly any[]> = T extends readonly [any, ...infer Rest] ? Rest : [];
export {};