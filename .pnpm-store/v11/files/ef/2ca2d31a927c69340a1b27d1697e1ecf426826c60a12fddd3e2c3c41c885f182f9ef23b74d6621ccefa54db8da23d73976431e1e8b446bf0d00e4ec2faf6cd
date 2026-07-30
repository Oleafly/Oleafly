import Trigger from '@rc-component/trigger';
import { clsx } from 'clsx';
import * as React from 'react';
import { getRealPlacement } from "../utils/uiUtil";
import PickerContext from "../PickerInput/context";
const BUILT_IN_PLACEMENTS = {
  bottomLeft: {
    points: ['tl', 'bl'],
    offset: [0, 4],
    overflow: {
      adjustX: 1,
      adjustY: 1
    }
  },
  bottomRight: {
    points: ['tr', 'br'],
    offset: [0, 4],
    overflow: {
      adjustX: 1,
      adjustY: 1
    }
  },
  topLeft: {
    points: ['bl', 'tl'],
    offset: [0, -4],
    overflow: {
      adjustX: 0,
      adjustY: 1
    }
  },
  topRight: {
    points: ['br', 'tr'],
    offset: [0, -4],
    overflow: {
      adjustX: 0,
      adjustY: 1
    }
  }
};
function PickerTrigger({
  popupElement,
  popupStyle,
  popupClassName,
  popupAlign,
  transitionName,
  getPopupContainer,
  children,
  range,
  placement,
  builtinPlacements = BUILT_IN_PLACEMENTS,
  direction,
  // Visible
  visible,
  onClose
}) {
  const {
    prefixCls
  } = React.useContext(PickerContext);
  const dropdownPrefixCls = `${prefixCls}-dropdown`;
  const realPlacement = getRealPlacement(placement, direction === 'rtl');
  return /*#__PURE__*/React.createElement(Trigger, {
    showAction: [],
    hideAction: ['click'],
    popupPlacement: realPlacement,
    builtinPlacements: builtinPlacements,
    prefixCls: dropdownPrefixCls,
    popupMotion: {
      motionName: transitionName
    },
    popup: popupElement,
    popupAlign: popupAlign,
    popupVisible: visible,
    popupClassName: clsx(popupClassName, {
      [`${dropdownPrefixCls}-range`]: range,
      [`${dropdownPrefixCls}-rtl`]: direction === 'rtl'
    }),
    popupStyle: popupStyle,
    stretch: "minWidth",
    getPopupContainer: getPopupContainer,
    onPopupVisibleChange: nextVisible => {
      if (!nextVisible) {
        onClose();
      }
    }
  }, children);
}
export default PickerTrigger;