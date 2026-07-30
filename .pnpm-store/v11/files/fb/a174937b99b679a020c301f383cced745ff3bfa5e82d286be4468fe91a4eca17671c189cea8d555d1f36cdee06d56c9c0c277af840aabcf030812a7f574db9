import * as React from 'react';
export default function useRefs() {
  const ref = React.useRef(null);
  if (ref.current === null) {
    ref.current = new Map();
  }
  const setRef = (key, element) => {
    ref.current.set(key, element);
  };
  const getRef = key => ref.current.get(key);
  return [setRef, getRef];
}