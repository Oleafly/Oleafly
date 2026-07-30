import _objectSpread from "@babel/runtime/helpers/esm/objectSpread2";
import { useMemo } from 'react';
import { theme } from 'antd';
import { useAntdStylish } from "./useAntdStylish";
export var useAntdTheme = function useAntdTheme() {
  var _theme$useToken = theme.useToken(),
    token = _theme$useToken.token,
    cssVar = _theme$useToken.cssVar;
  var stylish = useAntdStylish();
  return useMemo(function () {
    return _objectSpread(_objectSpread({}, token), {}, {
      stylish: stylish,
      cssVar: cssVar
    });
  }, [token, stylish, cssVar]);
};