export interface StackConfig {
    threshold?: number;
    offset?: number;
}
type StackParams = Required<StackConfig>;
type UseStack = (config?: boolean | StackConfig) => [boolean, StackParams];
/**
 * Resolves the stack setting into an enabled flag and normalized stack params.
 */
declare const useStack: UseStack;
export default useStack;
