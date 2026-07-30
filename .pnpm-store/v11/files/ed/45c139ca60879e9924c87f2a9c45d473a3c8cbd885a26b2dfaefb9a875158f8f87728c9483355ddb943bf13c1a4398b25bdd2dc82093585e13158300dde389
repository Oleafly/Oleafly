"use client";
import { jsx } from "react/jsx-runtime";
import { Divider } from "antd";
import { createStaticStyles, cx } from "antd-style";
//#region src/Form/components/FormDivider.tsx
const styles = createStaticStyles(({ css }) => {
	return { root: css`
      margin: 0;
      opacity: 0.66;
    ` };
});
const FormDivider = ({ visible = true, style, className, ...rest }) => {
	return /* @__PURE__ */ jsx(Divider, {
		className: cx(styles.root, className),
		style: {
			opacity: visible ? 1 : 0,
			...style
		},
		...rest
	});
};
FormDivider.displayName = "FormDivider";
//#endregion
export { FormDivider as default };

//# sourceMappingURL=FormDivider.mjs.map