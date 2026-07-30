"use client";
import { TooltipGroupHandleContext, TooltipGroupPropsContext } from "./groupContext.mjs";
import { useFloatingLayer } from "../../hooks/useFloatingLayer.mjs";
import { useAppElement } from "../../ThemeProvider/AppElementContext.mjs";
import { placementMap } from "../../utils/placement.mjs";
import { TooltipArrowIcon } from "./ArrowIcon.mjs";
import { styles } from "./style.mjs";
import TooltipContent from "./TooltipContent.mjs";
import { useDestroyOnInvalidActiveTriggerElement, useHidePopupWhenPositionerAtOrigin } from "../../utils/destroyOnInvalidActiveTriggerElement.mjs";
import { useCallback, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Tooltip } from "@base-ui/react/tooltip";
//#region src/base-ui/Tooltip/TooltipGroup.tsx
const TooltipGroup = ({ children, disableDestroyOnInvalidTrigger = false, disableZeroOriginGuard = false, layoutAnimation = false, popupContainer, ...sharedProps }) => {
	const [{ handle, key }, setHandleState] = useState(() => ({
		handle: Tooltip.createHandle(),
		key: 0
	}));
	const activeItemRef = useRef(null);
	const destroy = useCallback(() => {
		activeItemRef.current = null;
		setHandleState(({ key }) => ({
			handle: Tooltip.createHandle(),
			key: key + 1
		}));
	}, []);
	const handleOpenChange = useCallback((open) => {
		activeItemRef.current?.onOpenChange?.(open);
	}, []);
	const appElement = useAppElement();
	const portalContainer = useFloatingLayer() ?? appElement;
	useDestroyOnInvalidActiveTriggerElement(handle.store, destroy, { enabled: !disableDestroyOnInvalidTrigger });
	useHidePopupWhenPositionerAtOrigin(handle.store, { enabled: !disableZeroOriginGuard });
	return /* @__PURE__ */ jsx(TooltipGroupHandleContext, {
		value: handle,
		children: /* @__PURE__ */ jsxs(TooltipGroupPropsContext, {
			value: sharedProps,
			children: [children, /* @__PURE__ */ jsx(Tooltip.Root, {
				handle,
				onOpenChange: handleOpenChange,
				children: ({ payload }) => {
					const item = payload ?? null;
					activeItemRef.current = item;
					if (!item || item.title == null && !item.hotkey) return null;
					const arrow = item.arrow ?? false;
					const placement = item.placement ?? "top";
					const placementConfig = placementMap[placement] ?? placementMap.top;
					const baseSideOffset = arrow ? 8 : 6;
					const resolvedClassNames = {
						arrow: cx(styles.arrow, item.classNames?.arrow),
						popup: cx(styles.popup, item.className, item.classNames?.root, item.classNames?.container),
						positioner: styles.positioner,
						viewport: cx(styles.viewport, item.classNames?.content)
					};
					const resolvedStyleProps = (() => {
						if (typeof item.styles === "function") return void 0;
						return item.styles;
					})();
					const resolvedStyles = {
						arrow: resolvedStyleProps?.arrow,
						popup: {
							...resolvedStyleProps?.root,
							...resolvedStyleProps?.container
						},
						positioner: { zIndex: item.zIndex ?? 114514 },
						viewport: resolvedStyleProps?.content
					};
					const body = /* @__PURE__ */ jsx(Tooltip.Viewport, {
						className: resolvedClassNames.viewport,
						style: resolvedStyles.viewport,
						children: /* @__PURE__ */ jsx(TooltipContent, {
							hotkey: item.hotkey,
							hotkeyProps: item.hotkeyProps,
							title: item.title
						})
					});
					const popup = /* @__PURE__ */ jsx(Tooltip.Positioner, {
						align: placementConfig.align,
						className: resolvedClassNames.positioner,
						"data-layout-animation": layoutAnimation || void 0,
						"data-placement": placement,
						side: placementConfig.side,
						sideOffset: baseSideOffset,
						style: resolvedStyles.positioner,
						...item.positionerProps,
						children: /* @__PURE__ */ jsxs(Tooltip.Popup, {
							className: resolvedClassNames.popup,
							"data-layout-animation": layoutAnimation || void 0,
							style: resolvedStyles.popup,
							...item.popupProps,
							children: [arrow && /* @__PURE__ */ jsx(Tooltip.Arrow, {
								className: resolvedClassNames.arrow,
								style: resolvedStyles.arrow,
								children: TooltipArrowIcon
							}), body]
						})
					});
					const resolvedPortalContainer = item.popupContainer ?? popupContainer ?? portalContainer;
					return resolvedPortalContainer ? /* @__PURE__ */ jsx(Tooltip.Portal, {
						container: resolvedPortalContainer,
						children: popup
					}) : null;
				}
			}, key)]
		})
	});
};
TooltipGroup.displayName = "TooltipGroup";
//#endregion
export { TooltipGroup as default };

//# sourceMappingURL=TooltipGroup.mjs.map