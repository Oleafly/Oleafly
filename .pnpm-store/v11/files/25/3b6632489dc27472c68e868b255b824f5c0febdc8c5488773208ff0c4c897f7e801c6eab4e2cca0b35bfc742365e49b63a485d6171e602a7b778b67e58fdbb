"use client";

import * as React from 'react';
import { clsx } from 'clsx';
import { isNumber } from '../_util/is';
// Visually hidden styles for screen readers
const VISUALLY_HIDDEN_STYLE = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0
};
const Progress = props => {
  const {
    prefixCls,
    percent,
    render: progressRender,
    classNames: progressClassNames,
    styles: progressStyles,
    rootClassName,
    rootStyle,
    width,
    height
  } = props;
  // Check if percent is a valid finite number
  const hasPercent = isNumber(percent) && Number.isFinite(percent);
  // Calculate percent value (clamped to 0-100 for progress bar width)
  const percentValue = hasPercent ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  // ARIA attributes for accessibility
  const ariaProps = hasPercent ? {
    role: 'progressbar',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': percentValue,
    'aria-label': `${percentValue}%`
  } : {
    'aria-busy': true
  };
  // Render progress bar (rail with ::before pseudo for track)
  const progressBar = hasPercent ? (/*#__PURE__*/React.createElement("div", {
    className: clsx(`${prefixCls}-progress-rail`, progressClassNames?.rail),
    style: {
      ...progressStyles?.rail,
      '--progress-percent': `${percentValue}%`
    }
  })) : null;
  // Render progress content
  const progressContent = progressRender ? progressRender(progressBar, percentValue) : (/*#__PURE__*/React.createElement(React.Fragment, null, progressBar, hasPercent && (/*#__PURE__*/React.createElement("div", {
    className: clsx(`${prefixCls}-progress-indicator`, progressClassNames?.indicator),
    style: progressStyles?.indicator
  }, `${percentValue}%`))));
  return /*#__PURE__*/React.createElement("div", {
    className: clsx(prefixCls, `${prefixCls}-progress-wrapper`, progressClassNames?.root, rootClassName),
    style: {
      width,
      height,
      ...rootStyle,
      ...progressStyles?.root
    },
    ...ariaProps
  }, !hasPercent && (/*#__PURE__*/React.createElement("span", {
    role: "status",
    "aria-live": "polite",
    style: VISUALLY_HIDDEN_STYLE
  }, "Loading")), /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-progress-ink-1`
  }), /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-progress-ink-2`
  }), /*#__PURE__*/React.createElement("div", {
    className: clsx(`${prefixCls}-progress-content`, progressClassNames?.content),
    style: progressStyles?.content
  }, progressContent));
};
if (process.env.NODE_ENV !== 'production') {
  Progress.displayName = 'ImageProgress';
}
export default Progress;