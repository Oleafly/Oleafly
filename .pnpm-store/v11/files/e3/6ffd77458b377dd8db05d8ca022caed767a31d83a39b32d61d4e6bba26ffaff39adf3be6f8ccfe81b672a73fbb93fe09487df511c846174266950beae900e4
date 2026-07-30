import * as React from 'react';
import { composeRef, getNodeRef } from '@rc-component/util';
import { isPlainObject } from '../../_util/is';
import { FormContext } from '../context';
const useItemRef = () => {
  const {
    itemRef
  } = React.useContext(FormContext);
  const cacheRef = React.useRef({});
  const getRef = (name, children) => {
    // Outer caller already check the `supportRef`
    const childrenRef = children && isPlainObject(children) && getNodeRef(children);
    const nameStr = name.join('_');
    if (cacheRef.current.name !== nameStr || cacheRef.current.originRef !== childrenRef) {
      cacheRef.current.name = nameStr;
      cacheRef.current.originRef = childrenRef;
      cacheRef.current.ref = composeRef(itemRef(name), childrenRef);
    }
    return cacheRef.current.ref;
  };
  return getRef;
};
export default useItemRef;