"use client";
import Icon from "../../Icon/Icon.mjs";
import { styles } from "./style.mjs";
import { SwitchIcon, SwitchRoot, SwitchThumb } from "./atoms.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Loader2 } from "lucide-react";
//#region src/base-ui/Switch/Switch.tsx
const Switch = memo(({ autoFocus, checked, checkedChildren, className, classNames, defaultChecked, defaultValue, disabled, id, loading, name, onChange, onClick, ref, rootClassName, size = "default", style, styles: customStyles, tabIndex, title, unCheckedChildren, value }) => {
	const isDisabled = disabled || loading;
	const resolvedChecked = value ?? checked;
	const resolvedDefaultChecked = defaultValue ?? defaultChecked;
	return /* @__PURE__ */ jsxs(SwitchRoot, {
		autoFocus,
		checked: resolvedChecked,
		className: cx(className, rootClassName, classNames?.root),
		defaultChecked: resolvedDefaultChecked,
		disabled: isDisabled,
		id,
		name,
		ref,
		size,
		style: {
			...style,
			...customStyles?.root
		},
		tabIndex,
		title,
		onCheckedChange: onChange,
		onClick,
		children: [
			checkedChildren && /* @__PURE__ */ jsx(SwitchIcon, {
				className: classNames?.content,
				position: "left",
				size,
				style: customStyles?.content,
				children: checkedChildren
			}),
			unCheckedChildren && /* @__PURE__ */ jsx(SwitchIcon, {
				className: classNames?.content,
				position: "right",
				size,
				style: customStyles?.content,
				children: unCheckedChildren
			}),
			/* @__PURE__ */ jsx(SwitchThumb, {
				className: classNames?.thumb,
				size,
				style: customStyles?.thumb,
				children: loading && /* @__PURE__ */ jsx(Icon, {
					className: styles.loading,
					icon: Loader2,
					size: size === "small" ? 8 : 12,
					style: { color: "var(--lobe-color-primary)" }
				})
			})
		]
	});
});
Switch.displayName = "Switch";
//#endregion
export { Switch as default };

//# sourceMappingURL=Switch.mjs.map