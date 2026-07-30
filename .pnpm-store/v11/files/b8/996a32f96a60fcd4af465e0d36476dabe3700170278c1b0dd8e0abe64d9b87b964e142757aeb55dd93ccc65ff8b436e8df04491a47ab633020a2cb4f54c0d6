"use client";
import Radio from "./Radio.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { RadioGroup } from "@base-ui/react/radio-group";
//#region src/base-ui/Radio/RadioGroup.tsx
const RadioGroup$1 = memo(({ options, onChange, gap = 12, horizontal = true, size, textProps, style, ...rest }) => {
	const items = useMemo(() => options.map((option) => typeof option === "string" ? {
		label: option,
		value: option
	} : option), [options]);
	return /* @__PURE__ */ jsx(RadioGroup, {
		style: {
			display: "flex",
			flexDirection: horizontal ? "row" : "column",
			flexWrap: "wrap",
			gap,
			...style
		},
		onValueChange: onChange,
		...rest,
		children: items.map((item) => /* @__PURE__ */ jsx(Radio, {
			disabled: item.disabled,
			size,
			textProps,
			value: item.value,
			children: item.label
		}, item.value))
	});
});
RadioGroup$1.displayName = "RadioGroup";
//#endregion
export { RadioGroup$1 as default };

//# sourceMappingURL=RadioGroup.mjs.map