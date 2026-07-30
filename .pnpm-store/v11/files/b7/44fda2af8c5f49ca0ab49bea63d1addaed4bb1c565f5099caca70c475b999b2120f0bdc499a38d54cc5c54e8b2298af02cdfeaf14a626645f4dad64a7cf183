const DEFAULT_OFFSET = 8;
const DEFAULT_THRESHOLD = 3;
/**
 * Resolves the stack setting into an enabled flag and normalized stack params.
 */
const useStack = config => {
  const result = {
    offset: DEFAULT_OFFSET,
    threshold: DEFAULT_THRESHOLD
  };
  if (config && typeof config === 'object') {
    result.offset = config.offset ?? DEFAULT_OFFSET;
    result.threshold = config.threshold ?? DEFAULT_THRESHOLD;
  }
  return [!!config, result];
};
export default useStack;