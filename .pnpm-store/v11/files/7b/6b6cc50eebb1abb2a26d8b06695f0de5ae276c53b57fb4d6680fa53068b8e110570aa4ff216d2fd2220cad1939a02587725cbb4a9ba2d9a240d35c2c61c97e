"use client";

import * as React from 'react';
import { clsx } from 'clsx';
import { useMergeSemantic, useSemanticRootStyle } from '../_util/hooks/useMergeSemantic';
import { useComponentConfig } from '../config-provider/context';
const CardMeta = props => {
  const {
    prefixCls: customizePrefixCls,
    className,
    avatar,
    title,
    description,
    style,
    classNames: cardMetaClassNames,
    styles,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    className: contextClassName,
    style: contextStyle,
    classNames: contextClassNames,
    styles: contextStyles
  } = useComponentConfig('cardMeta');
  const prefixCls = getPrefixCls('card', customizePrefixCls);
  const metaPrefixCls = `${prefixCls}-meta`;
  const contextStyleRoot = useSemanticRootStyle(contextStyle);
  const styleRoot = useSemanticRootStyle(style);
  const [mergedClassNames, mergedStyles] = useMergeSemantic([contextClassNames, cardMetaClassNames], [contextStyles, contextStyleRoot, styles, styleRoot], {
    props
  });
  const rootClassNames = clsx(metaPrefixCls, className, contextClassName, mergedClassNames.root);
  const rootStyles = {
    ...mergedStyles.root
  };
  const avatarClassNames = clsx(`${metaPrefixCls}-avatar`, mergedClassNames.avatar);
  const titleClassNames = clsx(`${metaPrefixCls}-title`, mergedClassNames.title);
  const descriptionClassNames = clsx(`${metaPrefixCls}-description`, mergedClassNames.description);
  const sectionClassNames = clsx(`${metaPrefixCls}-section`, mergedClassNames.section);
  const avatarDom = avatar ? (/*#__PURE__*/React.createElement("div", {
    className: avatarClassNames,
    style: mergedStyles.avatar
  }, avatar)) : null;
  const titleDom = title ? (/*#__PURE__*/React.createElement("div", {
    className: titleClassNames,
    style: mergedStyles.title
  }, title)) : null;
  const descriptionDom = description ? (/*#__PURE__*/React.createElement("div", {
    className: descriptionClassNames,
    style: mergedStyles.description
  }, description)) : null;
  const MetaDetail = titleDom || descriptionDom ? (/*#__PURE__*/React.createElement("div", {
    className: sectionClassNames,
    style: mergedStyles.section
  }, titleDom, descriptionDom)) : null;
  return /*#__PURE__*/React.createElement("div", {
    ...restProps,
    className: rootClassNames,
    style: rootStyles
  }, avatarDom, MetaDetail);
};
if (process.env.NODE_ENV !== 'production') {
  CardMeta.displayName = 'CardMeta';
}
export default CardMeta;