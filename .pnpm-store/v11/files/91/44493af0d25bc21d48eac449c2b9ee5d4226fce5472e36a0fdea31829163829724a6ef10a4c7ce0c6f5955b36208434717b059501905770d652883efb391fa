"use client";

import * as React from 'react';
import CheckOutlined from "@ant-design/icons/es/icons/CheckOutlined";
import CloseCircleFilled from "@ant-design/icons/es/icons/CloseCircleFilled";
import CloseOutlined from "@ant-design/icons/es/icons/CloseOutlined";
import DownOutlined from "@ant-design/icons/es/icons/DownOutlined";
import LoadingOutlined from "@ant-design/icons/es/icons/LoadingOutlined";
import SearchOutlined from "@ant-design/icons/es/icons/SearchOutlined";
import fallbackProp from '../_util/fallbackProp';
import { devUseWarning } from '../_util/warning';
export default function useIcons({
  suffixIcon,
  contextSuffixIcon,
  clearIcon,
  contextClearIcon,
  menuItemSelectedIcon,
  contextMenuItemSelectedIcon,
  removeIcon,
  contextRemoveIcon,
  loading,
  loadingIcon,
  contextLoadingIcon,
  searchIcon,
  contextSearchIcon,
  multiple,
  hasFeedback,
  showSuffixIcon,
  feedbackIcon,
  showArrow,
  componentName
}) {
  if (process.env.NODE_ENV !== 'production') {
    const warning = devUseWarning(componentName);
    warning.deprecated(!clearIcon, 'clearIcon', 'allowClear={{ clearIcon: React.ReactNode }}');
  }
  return React.useMemo(() => {
    // Clear Icon
    const mergedClearIcon = fallbackProp(clearIcon, contextClearIcon, /*#__PURE__*/React.createElement(CloseCircleFilled, null));
    // Validation Feedback Icon
    const getSuffixIconNode = arrowIcon => {
      if (suffixIcon === null && !hasFeedback && !showArrow) {
        return null;
      }
      return /*#__PURE__*/React.createElement(React.Fragment, null, showSuffixIcon !== false && arrowIcon, hasFeedback && feedbackIcon);
    };
    // Arrow item icon
    let mergedSuffixIcon = null;
    if (suffixIcon !== undefined) {
      mergedSuffixIcon = getSuffixIconNode(suffixIcon);
    } else if (loading) {
      mergedSuffixIcon = getSuffixIconNode(fallbackProp(loadingIcon, contextLoadingIcon, /*#__PURE__*/React.createElement(LoadingOutlined, {
        spin: true
      })));
    } else {
      mergedSuffixIcon = ({
        open,
        showSearch
      }) => {
        if (open && showSearch) {
          return getSuffixIconNode(fallbackProp(searchIcon, contextSearchIcon, /*#__PURE__*/React.createElement(SearchOutlined, null)));
        }
        return getSuffixIconNode(fallbackProp(contextSuffixIcon, /*#__PURE__*/React.createElement(DownOutlined, null)));
      };
    }
    // Checked item icon
    const mergedItemIcon = fallbackProp(menuItemSelectedIcon, contextMenuItemSelectedIcon, multiple ? /*#__PURE__*/React.createElement(CheckOutlined, null) : null);
    const mergedRemoveIcon = fallbackProp(removeIcon, contextRemoveIcon, /*#__PURE__*/React.createElement(CloseOutlined, null));
    return {
      clearIcon: mergedClearIcon,
      suffixIcon: mergedSuffixIcon,
      itemIcon: mergedItemIcon,
      removeIcon: mergedRemoveIcon
    };
  }, [suffixIcon, contextSuffixIcon, clearIcon, contextClearIcon, menuItemSelectedIcon, contextMenuItemSelectedIcon, removeIcon, contextRemoveIcon, loading, loadingIcon, contextLoadingIcon, searchIcon, contextSearchIcon, multiple, hasFeedback, showSuffixIcon, feedbackIcon, showArrow]);
}