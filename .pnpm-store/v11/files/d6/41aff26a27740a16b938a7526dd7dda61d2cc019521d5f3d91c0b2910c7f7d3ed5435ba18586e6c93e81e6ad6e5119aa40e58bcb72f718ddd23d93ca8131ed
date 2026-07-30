"use client";
import { useNativeButton } from "../../hooks/useNativeButton.mjs";
import { parseTrigger } from "../../utils/parseTrigger.mjs";
import { PopoverGroupHandleContext } from "./groupContext.mjs";
import { useMergedPopoverProps } from "./useMergedPopoverProps.mjs";
import { cloneElement, isValidElement, use, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { mergeProps } from "@base-ui/react/merge-props";
import { mergeRefs } from "react-merge-refs";
import { Popover } from "@base-ui/react/popover";
//#region src/base-ui/Popover/PopoverInGroup.tsx
const PopoverInGroup = ({ children, ref: refProp, ...props }) => {
	const group = use(PopoverGroupHandleContext);
	const item = useMergedPopoverProps(props);
	const { openOnHover } = useMemo(() => parseTrigger(item.trigger ?? "hover"), [item.trigger]);
	const resolvedOpenDelay = item.openDelay ?? (item.mouseEnterDelay ?? .1) * 1e3;
	const resolvedCloseDelay = item.closeDelay ?? (item.mouseLeaveDelay ?? .1) * 1e3;
	const disabled = Boolean(item.disabled);
	const { isNativeButtonTriggerElement, resolvedNativeButton } = useNativeButton({
		children,
		nativeButton: item.nativeButton
	});
	if (!item.content) return children;
	const triggerProps = {
		closeDelay: resolvedCloseDelay,
		delay: resolvedOpenDelay,
		disabled,
		openOnHover: openOnHover && !disabled,
		payload: item
	};
	const triggerClassName = item.classNames?.trigger;
	if (isValidElement(children)) return /* @__PURE__ */ jsx(Popover.Trigger, {
		handle: group ?? void 0,
		...triggerProps,
		nativeButton: resolvedNativeButton,
		render: (renderProps) => {
			const resolvedProps = (() => {
				if (isNativeButtonTriggerElement) return renderProps;
				const { type, ref: triggerRef, ...restProps } = renderProps;
				return restProps;
			})();
			const mergedProps = mergeProps(children.props, resolvedProps);
			return cloneElement(children, {
				...mergedProps,
				className: cx(mergedProps.className, triggerClassName),
				ref: mergeRefs([
					children.ref,
					renderProps.ref,
					refProp
				])
			});
		}
	});
	return /* @__PURE__ */ jsx(Popover.Trigger, {
		handle: group ?? void 0,
		...triggerProps,
		className: triggerClassName,
		nativeButton: resolvedNativeButton,
		ref: refProp,
		children
	});
};
PopoverInGroup.displayName = "PopoverInGroup";
//#endregion
export { PopoverInGroup };

//# sourceMappingURL=PopoverInGroup.mjs.map