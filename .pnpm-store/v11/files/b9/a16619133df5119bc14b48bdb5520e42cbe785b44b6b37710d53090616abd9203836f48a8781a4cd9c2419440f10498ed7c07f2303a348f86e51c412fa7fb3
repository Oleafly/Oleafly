"use client";
import Icon from "../../Icon/Icon.mjs";
import { styles } from "./style.mjs";
import Input from "./Input.mjs";
import { memo, useState } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { Eye, EyeOff } from "lucide-react";
//#region src/base-ui/Input/InputPassword.tsx
const InputPassword = memo(({ visibilityToggle = true, suffix, ...rest }) => {
	const [visible, setVisible] = useState(false);
	return /* @__PURE__ */ jsx(Input, {
		type: visible ? "text" : "password",
		suffix: /* @__PURE__ */ jsxs(Fragment$1, { children: [suffix, visibilityToggle && /* @__PURE__ */ jsx("button", {
			"aria-label": visible ? "Hide password" : "Show password",
			className: styles.passwordToggle,
			tabIndex: -1,
			type: "button",
			onClick: () => setVisible((v) => !v),
			children: /* @__PURE__ */ jsx(Icon, {
				icon: visible ? Eye : EyeOff,
				size: 16
			})
		})] }),
		...rest
	});
});
InputPassword.displayName = "InputPassword";
//#endregion
export { InputPassword as default };

//# sourceMappingURL=InputPassword.mjs.map