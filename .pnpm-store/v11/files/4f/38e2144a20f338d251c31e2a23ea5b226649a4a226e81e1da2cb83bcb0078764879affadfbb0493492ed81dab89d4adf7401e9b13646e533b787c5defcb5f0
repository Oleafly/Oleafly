"use client";
import { fieldStyles, fieldVariants } from "../style.mjs";
import FormDivider from "./FormDivider.mjs";
import { useFormContext } from "../context.mjs";
import FormTitle from "./FormTitle.mjs";
import { cloneElement, isValidElement, memo, useMemo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cx, useResponsive } from "antd-style";
import { Field } from "@base-ui/react/field";
//#region src/base-ui/Form/components/FormField.tsx
const FormField = memo(({ avatar, children, className, desc, divider, hidden, label, layout, minWidth, name, required, style, tag, variant, ...rest }) => {
	const { mobile } = useResponsive();
	const config = useFormContext();
	const mergedLayout = layout || (mobile ? "vertical" : config.layout);
	const mergedVariant = variant || config.variant;
	const mergedMinWidth = minWidth ?? config.itemMinWidth;
	const control = useMemo(() => {
		if (!isValidElement(children)) return children;
		const props = children.props;
		const injected = {};
		if (required && props.required === void 0) injected.required = true;
		if (name) {
			const initialValue = config.initialValues?.[name];
			if (initialValue !== void 0 && props.value === void 0 && props.defaultValue === void 0) injected.defaultValue = initialValue;
		}
		if (Object.keys(injected).length === 0) return children;
		return cloneElement(children, injected);
	}, [
		children,
		name,
		required,
		config.initialValues
	]);
	if (hidden) return null;
	return /* @__PURE__ */ jsxs(Fragment$1, { children: [divider && /* @__PURE__ */ jsx(FormDivider, { visible: mergedVariant !== "borderless" }), /* @__PURE__ */ jsxs(Field.Root, {
		className: cx(fieldVariants({ layout: mergedLayout }), className),
		name,
		style,
		...rest,
		children: [/* @__PURE__ */ jsx(Field.Label, {
			className: fieldStyles.label,
			children: /* @__PURE__ */ jsx(FormTitle, {
				avatar,
				desc,
				tag,
				title: label
			})
		}), /* @__PURE__ */ jsxs("div", {
			className: cx(fieldStyles.control, mergedLayout === "vertical" && fieldStyles.controlVertical),
			style: mergedMinWidth === void 0 || mergedMinWidth === null || mergedMinWidth === "" ? void 0 : { minWidth: typeof mergedMinWidth === "number" ? `${mergedMinWidth}px` : mergedMinWidth },
			children: [control, /* @__PURE__ */ jsx(Field.Error, { className: fieldStyles.error })]
		})]
	})] });
});
FormField.displayName = "FormField";
//#endregion
export { FormField as default };

//# sourceMappingURL=FormField.mjs.map