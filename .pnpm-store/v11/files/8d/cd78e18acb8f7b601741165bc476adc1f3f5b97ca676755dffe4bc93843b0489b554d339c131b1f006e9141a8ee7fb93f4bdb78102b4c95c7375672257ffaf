import * as React from 'react';
export default function usePickerRef(ref) {
  const selectorRef = React.useRef();
  React.useImperativeHandle(ref, () => ({
    nativeElement: selectorRef.current?.nativeElement,
    focus: options => {
      selectorRef.current?.focus(options);
    },
    blur: () => {
      selectorRef.current?.blur();
    }
  }));
  return selectorRef;
}