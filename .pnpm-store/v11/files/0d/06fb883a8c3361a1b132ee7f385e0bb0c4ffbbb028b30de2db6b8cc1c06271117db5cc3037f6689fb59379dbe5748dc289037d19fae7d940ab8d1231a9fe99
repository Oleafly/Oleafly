"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Button from "../Button/Button.mjs";
import Form from "../Form/index.mjs";
import Modal from "../Modal/Modal.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx, useResponsive } from "antd-style";
//#region src/FormModal/FormModal.tsx
const FormModal = memo(({ classNames = {}, className, style, closable, styles: styles$1 = {}, allowFullscreen, title, afterOpenChange, width, onCancel, centered, open, afterClose, destroyOnHidden, closeIcon, paddings, height, enableResponsive, zIndex, mask, getContainer, keyboard, focusTriggerAfterClose, forceRender, loading, footer, submitButtonProps, submitLoading, onFinish, submitText, variant = "borderless", gap, onSubmit, children, ref, ...rest }) => {
	const { mobile } = useResponsive();
	const { form: formClassName, ...modalClassNames } = classNames;
	const { form: formStyle, ...modalStyles } = typeof styles$1 === "function" ? { form: void 0 } : styles$1;
	return /* @__PURE__ */ jsx(Modal, {
		afterClose,
		afterOpenChange,
		allowFullscreen,
		centered,
		className,
		classNames: modalClassNames,
		closable,
		closeIcon,
		confirmLoading: submitLoading,
		destroyOnHidden,
		enableResponsive,
		focusTriggerAfterClose,
		footer: null,
		forceRender,
		getContainer,
		height,
		keyboard,
		loading,
		mask,
		open,
		paddings,
		style,
		title,
		width,
		zIndex,
		styles: typeof styles$1 === "function" ? styles$1 : {
			...modalStyles,
			body: {
				paddingTop: mobile ? 0 : void 0,
				...modalStyles?.body
			}
		},
		onCancel,
		children: /* @__PURE__ */ jsx(Form, {
			className: cx(styles.form, formClassName || ""),
			clearOnDestroy: destroyOnHidden,
			gap: gap || (variant === "borderless" ? 24 : gap),
			ref,
			variant,
			footer: /* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				align: "center",
				className: styles.footer,
				gap: 8,
				children: footer || /* @__PURE__ */ jsx(Button, {
					block: true,
					htmlType: "submit",
					loading: submitLoading,
					type: "primary",
					onClick: onSubmit,
					...submitButtonProps,
					style: {
						flex: 1,
						...submitButtonProps?.style
					},
					children: submitText || "Submit"
				})
			}),
			style: {
				paddingBottom: 56,
				...formStyle
			},
			styles: { title: { fontSize: 14 } },
			onFinish,
			...rest,
			children
		})
	});
});
FormModal.displayName = "FormModal";
//#endregion
export { FormModal as default };

//# sourceMappingURL=FormModal.mjs.map