import { clsx } from 'clsx';
import { useLayoutEffect } from '@rc-component/util';
import * as React from 'react';
import { usePanelContext } from "../../context";
import useScrollTo from "./useScrollTo";
const SCROLL_DELAY = 300;
// Not use JSON.stringify to avoid dead loop
function flattenUnits(units) {
  return units.map(({
    value,
    label,
    disabled
  }) => [value, label, disabled].join(',')).join(';');
}
export default function TimeColumn(props) {
  const {
    units,
    value,
    optionalValue,
    type,
    onChange,
    onHover,
    onDblClick,
    changeOnScroll
  } = props;
  const {
    prefixCls,
    cellRender,
    now,
    locale,
    classNames,
    styles
  } = usePanelContext();
  const panelPrefixCls = `${prefixCls}-time-panel`;
  const cellPrefixCls = `${prefixCls}-time-panel-cell`;

  // ========================== Refs ==========================
  const ulRef = React.useRef(null);

  // ========================= Scroll =========================
  const checkDelayRef = React.useRef();
  const clearDelayCheck = () => {
    clearTimeout(checkDelayRef.current);
  };

  // ========================== Sync ==========================
  const [syncScroll, stopScroll, isScrolling] = useScrollTo(ulRef, value ?? optionalValue);

  // Effect sync value scroll
  useLayoutEffect(() => {
    syncScroll();
    clearDelayCheck();
    return () => {
      stopScroll();
      clearDelayCheck();
    };
  }, [value, optionalValue, flattenUnits(units)]);

  // ========================= Change =========================
  // Scroll event if sync onScroll
  const onInternalScroll = event => {
    clearDelayCheck();
    const target = event.target;
    if (!isScrolling() && changeOnScroll) {
      checkDelayRef.current = setTimeout(() => {
        const ul = ulRef.current;
        const firstLiTop = ul.querySelector(`li`).offsetTop;
        const liList = Array.from(ul.querySelectorAll(`li`));
        const liTopList = liList.map(li => li.offsetTop - firstLiTop);
        const liDistList = liTopList.map((top, index) => {
          if (units[index].disabled) {
            return Number.MAX_SAFE_INTEGER;
          }
          return Math.abs(top - target.scrollTop);
        });

        // Find min distance index
        const minDist = Math.min(...liDistList);
        const minDistIndex = liDistList.findIndex(dist => dist === minDist);
        const targetUnit = units[minDistIndex];
        if (targetUnit && !targetUnit.disabled) {
          onChange(targetUnit.value);
        }
      }, SCROLL_DELAY);
    }
  };

  // ========================= Render =========================
  const columnPrefixCls = `${panelPrefixCls}-column`;
  return /*#__PURE__*/React.createElement("ul", {
    className: columnPrefixCls,
    ref: ulRef,
    "data-type": type,
    onScroll: onInternalScroll
  }, units.map(({
    label,
    value: unitValue,
    disabled
  }) => {
    const inner = /*#__PURE__*/React.createElement("div", {
      className: `${cellPrefixCls}-inner`
    }, label);
    return /*#__PURE__*/React.createElement("li", {
      key: unitValue,
      style: styles.item,
      className: clsx(cellPrefixCls, classNames.item, {
        [`${cellPrefixCls}-selected`]: value === unitValue,
        [`${cellPrefixCls}-disabled`]: disabled
      }),
      onClick: () => {
        if (!disabled) {
          onChange(unitValue);
        }
      },
      onDoubleClick: () => {
        if (!disabled && onDblClick) {
          onDblClick();
        }
      },
      onMouseEnter: () => {
        onHover(unitValue);
      },
      onMouseLeave: () => {
        onHover(null);
      },
      "data-value": unitValue
    }, cellRender ? cellRender(unitValue, {
      prefixCls,
      originNode: inner,
      today: now,
      type: 'time',
      subType: type,
      locale
    }) : inner);
  }));
}