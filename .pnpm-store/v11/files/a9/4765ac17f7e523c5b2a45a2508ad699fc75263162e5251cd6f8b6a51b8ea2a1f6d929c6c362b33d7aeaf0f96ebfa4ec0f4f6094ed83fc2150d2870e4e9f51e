"use client";

import * as React from 'react';
import DeleteOutlined from "@ant-design/icons/es/icons/DeleteOutlined";
import DownloadOutlined from "@ant-design/icons/es/icons/DownloadOutlined";
import EyeOutlined from "@ant-design/icons/es/icons/EyeOutlined";
import CSSMotion from '@rc-component/motion';
import { clsx } from 'clsx';
import { isFunction } from '../../_util/is';
import { ConfigContext } from '../../config-provider';
import Progress from '../../progress';
import Tooltip from '../../tooltip';
const ListItem = /*#__PURE__*/React.forwardRef(({
  prefixCls,
  className,
  style,
  classNames: itemClassNames,
  styles,
  locale,
  listType,
  file,
  items,
  progress: progressProps,
  iconRender,
  actionIconRender,
  itemRender,
  isImgUrl,
  showPreviewIcon,
  showRemoveIcon,
  showDownloadIcon,
  previewIcon: customPreviewIcon,
  removeIcon: customRemoveIcon,
  downloadIcon: customDownloadIcon,
  extra: customExtra,
  onPreview,
  onDownload,
  onClose
}, ref) => {
  // Status: which will ignore `removed` status
  const {
    status
  } = file;
  const [mergedStatus, setMergedStatus] = React.useState(status);
  React.useEffect(() => {
    if (status !== 'removed') {
      setMergedStatus(status);
    }
  }, [status]);
  // Delay to show the progress bar
  const [showProgress, setShowProgress] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setShowProgress(true);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  const iconNode = iconRender(file);
  let icon = /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-icon`
  }, iconNode);
  if (listType === 'picture' || listType === 'picture-card' || listType === 'picture-circle') {
    if (mergedStatus === 'uploading' || !file.thumbUrl && !file.url) {
      const uploadingClassName = clsx(`${prefixCls}-list-item-thumbnail`, {
        [`${prefixCls}-list-item-file`]: mergedStatus !== 'uploading'
      });
      icon = /*#__PURE__*/React.createElement("div", {
        className: uploadingClassName
      }, iconNode);
    } else {
      const thumbnail = isImgUrl?.(file) ? (/*#__PURE__*/React.createElement("img", {
        src: file.thumbUrl || file.url,
        alt: file.name,
        className: `${prefixCls}-list-item-image`,
        crossOrigin: file.crossOrigin
      })) : iconNode;
      const aClassName = clsx(`${prefixCls}-list-item-thumbnail`, {
        [`${prefixCls}-list-item-file`]: isImgUrl && !isImgUrl(file)
      });
      icon = /*#__PURE__*/React.createElement("a", {
        className: aClassName,
        onClick: e => onPreview(file, e),
        href: file.url || file.thumbUrl,
        target: "_blank",
        rel: "noopener noreferrer"
      }, thumbnail);
    }
  }
  const listItemClassName = clsx(`${prefixCls}-list-item`, `${prefixCls}-list-item-${mergedStatus}`, itemClassNames?.item);
  const linkProps = typeof file.linkProps === 'string' ? JSON.parse(file.linkProps) : file.linkProps;
  const removeIcon = (isFunction(showRemoveIcon) ? showRemoveIcon(file) : showRemoveIcon) ? actionIconRender((isFunction(customRemoveIcon) ? customRemoveIcon(file) : customRemoveIcon) || (/*#__PURE__*/React.createElement(DeleteOutlined, null)), () => onClose(file), prefixCls, locale.removeFile,
  // acceptUploadDisabled is true, only remove icon will follow Upload disabled prop
  // https://github.com/ant-design/ant-design/issues/46171
  true) : null;
  const downloadIcon = (isFunction(showDownloadIcon) ? showDownloadIcon(file) : showDownloadIcon) && mergedStatus === 'done' ? actionIconRender((isFunction(customDownloadIcon) ? customDownloadIcon(file) : customDownloadIcon) || (/*#__PURE__*/React.createElement(DownloadOutlined, null)), () => onDownload(file), prefixCls, locale.downloadFile) : null;
  const downloadOrDelete = listType !== 'picture-card' && listType !== 'picture-circle' && (/*#__PURE__*/React.createElement("span", {
    key: "download-delete",
    className: clsx(`${prefixCls}-list-item-actions`, {
      picture: listType === 'picture'
    })
  }, downloadIcon, removeIcon));
  const extraContent = isFunction(customExtra) ? customExtra(file) : customExtra;
  const extra = extraContent && (/*#__PURE__*/React.createElement("span", {
    className: `${prefixCls}-list-item-extra`
  }, extraContent));
  const listItemNameClass = clsx(`${prefixCls}-list-item-name`);
  const onPreviewKeyDown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPreview(file, e);
    }
  };
  const fileName = file.url ? (/*#__PURE__*/React.createElement("a", {
    key: "view",
    target: "_blank",
    rel: "noopener noreferrer",
    className: listItemNameClass,
    title: file.name,
    ...linkProps,
    href: file.url,
    onClick: e => onPreview(file, e)
  }, file.name, extra)) : (/*#__PURE__*/React.createElement("span", {
    key: "view",
    role: "button",
    tabIndex: 0,
    className: listItemNameClass,
    onClick: e => onPreview(file, e),
    onKeyDown: onPreviewKeyDown,
    title: file.name
  }, file.name, extra));
  const previewIcon = (isFunction(showPreviewIcon) ? showPreviewIcon(file) : showPreviewIcon) && (file.url || file.thumbUrl) ? (/*#__PURE__*/React.createElement("a", {
    href: file.url || file.thumbUrl,
    target: "_blank",
    rel: "noopener noreferrer",
    onClick: e => onPreview(file, e),
    title: locale.previewFile
  }, isFunction(customPreviewIcon) ? customPreviewIcon(file) : customPreviewIcon || /*#__PURE__*/React.createElement(EyeOutlined, null))) : null;
  const pictureCardActions = (listType === 'picture-card' || listType === 'picture-circle') && mergedStatus !== 'uploading' && (/*#__PURE__*/React.createElement("span", {
    className: `${prefixCls}-list-item-actions`
  }, previewIcon, mergedStatus === 'done' && downloadIcon, removeIcon));
  const {
    getPrefixCls
  } = React.useContext(ConfigContext);
  const rootPrefixCls = getPrefixCls();
  const dom = /*#__PURE__*/React.createElement("div", {
    className: listItemClassName,
    style: styles?.item
  }, icon, fileName, downloadOrDelete, pictureCardActions, showProgress && (/*#__PURE__*/React.createElement(CSSMotion, {
    motionName: `${rootPrefixCls}-fade`,
    visible: mergedStatus === 'uploading',
    motionDeadline: 2000
  }, ({
    className: motionClassName
  }) => {
    // show loading icon if upload progress listener is disabled
    const loadingProgress = 'percent' in file ? (/*#__PURE__*/React.createElement(Progress, {
      type: "line",
      percent: file.percent,
      "aria-label": file['aria-label'],
      "aria-labelledby": file['aria-labelledby'],
      ...progressProps
    })) : null;
    return /*#__PURE__*/React.createElement("div", {
      className: clsx(`${prefixCls}-list-item-progress`, motionClassName)
    }, loadingProgress);
  })));
  const message = file.response && typeof file.response === 'string' ? file.response : file.error?.statusText || file.error?.message || locale.uploadError;
  const item = mergedStatus === 'error' ? (/*#__PURE__*/React.createElement(Tooltip, {
    title: message,
    getPopupContainer: node => node.parentNode
  }, dom)) : dom;
  return /*#__PURE__*/React.createElement("div", {
    className: clsx(`${prefixCls}-list-item-container`, className),
    style: style,
    ref: ref
  }, itemRender ? itemRender(item, file, items, {
    download: onDownload.bind(null, file),
    preview: onPreview.bind(null, file),
    remove: onClose.bind(null, file)
  }) : item);
});
export default ListItem;