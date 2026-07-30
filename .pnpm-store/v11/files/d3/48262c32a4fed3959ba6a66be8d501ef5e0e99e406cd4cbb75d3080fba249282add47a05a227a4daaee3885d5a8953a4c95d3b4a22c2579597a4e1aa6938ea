import { toArray } from '@rc-component/util';
import { isFunction } from '../../_util/is';
const useChildren = children => {
  if (isFunction(children)) {
    return children;
  }
  const childList = toArray(children);
  return childList.length <= 1 ? childList[0] : childList;
};
export default useChildren;