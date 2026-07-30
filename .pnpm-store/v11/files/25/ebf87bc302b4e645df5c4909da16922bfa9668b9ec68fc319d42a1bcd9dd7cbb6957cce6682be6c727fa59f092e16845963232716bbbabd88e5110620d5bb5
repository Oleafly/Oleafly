"use client";
import Checkbox from "./Checkbox.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
//#region src/base-ui/Checkbox/CheckboxGroup.tsx
const CheckboxGroup$1 = memo(({ options, onChange, gap = 12, horizontal = true, size, shape, textProps, style, ...rest }) => {
	const items = useMemo(() => options.map((option) => typeof option === "string" ? {
		label: option,
		value: option
	} : option), [options]);
	return /* @__PURE__ */ jsx(CheckboxGroup, {
		style: {
			display: "flex",
			flexDirection: horizontal ? "row" : "column",
			flexWrap: "wrap",
			gap,
			...style
		},
		onValueChange: onChange,
		...rest,
		children: items.map((item) => /* @__PURE__ */ jsx(Checkbox, {
			disabled: item.disabled,
			name: item.value,
			shape,
			size,
			textProps,
			value: item.value,
			children: item.label
		}, item.value))
	});
});
CheckboxGroup$1.displayName = "CheckboxGroup";
//#endregion
export { CheckboxGroup$1 as default };

//# sourceMappingURL=CheckboxGroup.mjs.map