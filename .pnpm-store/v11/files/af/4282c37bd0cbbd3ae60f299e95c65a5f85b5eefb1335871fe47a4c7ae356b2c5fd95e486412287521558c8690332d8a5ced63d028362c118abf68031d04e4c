"use client";

import _toConsumableArray from "@babel/runtime/helpers/esm/toConsumableArray";
import * as React from 'react';
import CSSMotion, { CSSMotionList } from '@rc-component/motion';
import { clsx } from 'clsx';
import { isNonNullable } from '../_util/is';
import initCollapseMotion from '../_util/motion';
import useCSSVarCls from '../config-provider/hooks/useCSSVarCls';
import { FormContext, FormItemPrefixContext } from './context';
import useDebounce from './hooks/useDebounce';
import useStyle from './style';
const EMPTY_LIST = [];
function toErrorEntity(error, prefix, errorStatus, index = 0) {
  return {
    key: typeof error === 'string' ? error : `${prefix}-${index}`,
    error,
    errorStatus
  };
}
const ErrorList = ({
  help,
  helpStatus,
  errors = EMPTY_LIST,
  warnings = EMPTY_LIST,
  className: rootClassName,
  fieldId,
  onVisibleChanged
}) => {
  const {
    prefixCls
  } = React.useContext(FormItemPrefixContext);
  const {
    classNames: contextClassNames,
    styles: contextStyles
  } = React.useContext(FormContext);
  const baseClassName = `${prefixCls}-item-explain`;
  const rootCls = useCSSVarCls(prefixCls);
  const [hashId, cssVarCls] = useStyle(prefixCls, rootCls);
  const collapseMotion = React.useMemo(() => initCollapseMotion(prefixCls), [prefixCls]);
  // We have to debounce here again since somewhere use ErrorList directly still need no shaking
  // ref: https://github.com/ant-design/ant-design/issues/36336
  const debounceErrors = useDebounce(errors);
  const debounceWarnings = useDebounce(warnings);
  const hasHelp = isNonNullable(help);
  const fullKeyList = React.useMemo(() => {
    if (hasHelp) {
      return [toErrorEntity(help, 'help', helpStatus)];
    }
    return [].concat(_toConsumableArray(debounceErrors.map((error, index) => toErrorEntity(error, 'error', 'error', index))), _toConsumableArray(debounceWarnings.map((warning, index) => toErrorEntity(warning, 'warning', 'warning', index))));
  }, [help, helpStatus, hasHelp, debounceErrors, debounceWarnings]);
  const filledKeyFullKeyList = React.useMemo(() => {
    const keysCount = {};
    fullKeyList.forEach(({
      key
    }) => {
      keysCount[key] = (keysCount[key] || 0) + 1;
    });
    return fullKeyList.map((entity, index) => ({
      ...entity,
      key: keysCount[entity.key] > 1 ? `${entity.key}-fallback-${index}` : entity.key
    }));
  }, [fullKeyList]);
  const helpProps = {};
  if (fieldId) {
    helpProps.id = `${fieldId}_help`;
  }
  return /*#__PURE__*/React.createElement(CSSMotion, {
    motionDeadline: collapseMotion.motionDeadline,
    motionName: `${prefixCls}-show-help`,
    visible: !!filledKeyFullKeyList.length,
    onVisibleChanged: onVisibleChanged
  }, holderProps => {
    const {
      className: holderClassName,
      style: holderStyle
    } = holderProps;
    return /*#__PURE__*/React.createElement("div", {
      ...helpProps,
      className: clsx(baseClassName, holderClassName, contextClassNames?.help, cssVarCls, rootCls, rootClassName, hashId),
      style: {
        ...contextStyles?.help,
        ...holderStyle
      }
    }, /*#__PURE__*/React.createElement(CSSMotionList, {
      keys: filledKeyFullKeyList,
      ...initCollapseMotion(prefixCls),
      motionName: `${prefixCls}-show-help-item`,
      component: false
    }, itemProps => {
      const {
        key,
        error,
        errorStatus,
        className: itemClassName,
        style: itemStyle
      } = itemProps;
      return /*#__PURE__*/React.createElement("div", {
        key: key,
        className: clsx(itemClassName, contextClassNames?.helpItem, {
          [`${baseClassName}-${errorStatus}`]: errorStatus
        }),
        style: {
          ...contextStyles?.helpItem,
          ...itemStyle
        }
      }, error);
    }));
  });
};
export default ErrorList;