"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import { flatGroupStyles, flatGroupVariants } from "../style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx, useResponsive } from "antd-style";
//#region src/Form/components/FormFlatGroup.tsx
const FormFlatGroup = memo(({ className, children, variant = "borderless", ...rest }) => {
	const { mobile } = useResponsive();
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		className: cx(mobile ? flatGroupStyles.mobile : flatGroupVariants({ variant }), className),
		...rest,
		children
	});
});
FormFlatGroup.displayName = "FormFlatGroup";
//#endregion
export { FormFlatGroup as default };

//# sourceMappingURL=FormFlatGroup.mjs.map