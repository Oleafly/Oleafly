import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Checkbox from "./Checkbox.mjs";
import { jsx } from "react/jsx-runtime";
import useMergeState from "use-merge-value";
//#region src/Checkbox/CheckboxGroup.tsx
const CheckboxGroup = ({ defaultValue, disabled, onChange, options, textProps, value, shape, size, ...rest }) => {
	const [selectedValues, setSelectedValues] = useMergeState(defaultValue || [], {
		defaultValue,
		onChange,
		value
	});
	const handleChange = (optionValue, checked) => {
		const newValues = checked ? [...selectedValues, optionValue] : selectedValues.filter((v) => v !== optionValue);
		setSelectedValues(newValues);
	};
	const normalizedOptions = options.map((option) => {
		if (typeof option === "string") return {
			disabled: false,
			label: option,
			value: option
		};
		return option;
	});
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		align: "center",
		gap: 16,
		wrap: "wrap",
		...rest,
		children: normalizedOptions.map((option) => {
			return /* @__PURE__ */ jsx(Checkbox, {
				checked: selectedValues.includes(option.value),
				disabled: disabled || option.disabled,
				shape,
				size,
				textProps,
				onChange: (checked) => handleChange(option.value, checked),
				children: option.label
			}, String(option.value));
		})
	});
};
CheckboxGroup.displayName = "CheckboxGroup";
//#endregion
export { CheckboxGroup as default };

//# sourceMappingURL=CheckboxGroup.mjs.map