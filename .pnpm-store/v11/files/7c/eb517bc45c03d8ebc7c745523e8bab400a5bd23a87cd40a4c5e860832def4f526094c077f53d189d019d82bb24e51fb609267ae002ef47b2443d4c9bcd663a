export interface UseControlledProps<T = unknown> {
  /**
   * Holds the component value when it's controlled.
   */
  controlled: T | undefined;
  /**
   * The default value when uncontrolled.
   */
  default: T | undefined;
  /**
   * The component name displayed in warnings.
   */
  name: string;
  /**
   * The name of the state variable displayed in warnings.
   */
  state?: string | undefined;
}
export declare function useControlled<T = unknown>({
  controlled,
  default: defaultProp,
  name,
  state
}: UseControlledProps<T>): [T, (newValue: T | ((prevValue: T) => T)) => void];