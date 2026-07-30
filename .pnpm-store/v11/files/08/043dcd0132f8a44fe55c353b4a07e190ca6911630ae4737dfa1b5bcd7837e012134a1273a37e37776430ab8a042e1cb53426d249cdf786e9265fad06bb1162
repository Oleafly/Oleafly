import * as React from 'react';
export const NotificationContext = /*#__PURE__*/React.createContext({});
const NotificationProvider = ({
  children,
  classNames
}) => {
  const context = React.useMemo(() => ({
    classNames
  }), [classNames]);
  return /*#__PURE__*/React.createElement(NotificationContext.Provider, {
    value: context
  }, children);
};
export default NotificationProvider;