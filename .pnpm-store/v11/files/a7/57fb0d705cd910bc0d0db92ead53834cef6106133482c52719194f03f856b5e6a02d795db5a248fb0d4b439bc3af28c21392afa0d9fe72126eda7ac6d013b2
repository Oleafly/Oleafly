"use client";

import React from 'react';
import CalendarOutlined from "@ant-design/icons/es/icons/CalendarOutlined";
import ClockCircleOutlined from "@ant-design/icons/es/icons/ClockCircleOutlined";
import { TIME } from './constant';
const useSuffixIcon = ({
  picker,
  hasFeedback,
  feedbackIcon,
  suffixIcon
}) => {
  if (suffixIcon === null || suffixIcon === false) {
    return null;
  }
  if (suffixIcon === true || suffixIcon === undefined) {
    return /*#__PURE__*/React.createElement(React.Fragment, null, picker === TIME ? (/*#__PURE__*/React.createElement(ClockCircleOutlined, {
      "aria-hidden": "true"
    })) : (/*#__PURE__*/React.createElement(CalendarOutlined, {
      "aria-hidden": "true"
    })), hasFeedback && feedbackIcon);
  }
  return suffixIcon;
};
export default useSuffixIcon;