import * as React from 'react';
export const Context = /*#__PURE__*/React.createContext({});
const MotionProvider = props => {
  const {
    children,
    ...rest
  } = props;
  const memoizedValue = React.useMemo(() => {
    return {
      motion: rest.motion
    };
  }, [rest.motion]);
  return /*#__PURE__*/React.createElement(Context.Provider, {
    value: memoizedValue
  }, children);
};
export default MotionProvider;