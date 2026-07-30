"use client";
import { useMotionComponent } from "../../MotionProvider/index.mjs";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Icon from "../../Icon/Icon.mjs";
import Button$1 from "../../Button/Button.mjs";
import { useTranslation } from "../../i18n/useTranslation.mjs";
import { submitFooterStyles } from "../style.mjs";
import form_default from "../../i18n/resources/en/form.mjs";
import { useFormContext } from "./FormProvider.mjs";
import { merge, removeUndefined } from "./merge.mjs";
import { memo, useEffect, useMemo, useState } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { Form } from "antd";
import { cssVar, cx } from "antd-style";
import { InfoIcon } from "lucide-react";
import isEqual from "fast-deep-equal";
//#region src/Form/components/FormSubmitFooter.tsx
const FormSubmitFooter = memo(({ enableReset = true, buttonProps, float, onReset, saveButtonProps, resetButtonProps, enableUnsavedWarning, children, texts, className, ...rest }) => {
	const Motion = useMotionComponent();
	const { form, initialValues, submitLoading } = useFormContext();
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const values = Form.useWatch([], form) || {};
	const { t } = useTranslation(form_default);
	const styles = submitFooterStyles;
	const v = useMemo(() => removeUndefined(values), [values]);
	const initialV = useMemo(() => removeUndefined(initialValues), [initialValues]);
	const mergedV = useMemo(() => merge(initialV, v), [v, initialV]);
	useEffect(() => {
		setHasUnsavedChanges(!isEqual(mergedV, initialV));
	}, [
		mergedV,
		initialV,
		submitLoading
	]);
	const unsavedWarningText = texts?.unSavedWarning ?? t("form.unsavedWarning");
	const unsavedText = texts?.unSaved ?? t("form.unsavedChanges");
	const resetText = texts?.reset ?? t("form.reset");
	const submitText = texts?.submit ?? t("form.submit");
	const fn = (e) => {
		if (hasUnsavedChanges) e.returnValue = unsavedWarningText;
		else delete e.returnValue;
	};
	useEffect(() => {
		if (!enableUnsavedWarning) return;
		if (typeof window === "undefined" || !hasUnsavedChanges) return;
		window.addEventListener("beforeunload", fn);
		return () => window.removeEventListener("beforeunload", fn);
	}, [
		enableUnsavedWarning,
		hasUnsavedChanges,
		unsavedWarningText
	]);
	const content = /* @__PURE__ */ jsxs(Fragment$1, { children: [
		(float || hasUnsavedChanges) && /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsx(Icon, {
			color: cssVar.colorTextDescription,
			icon: InfoIcon,
			size: 12,
			style: { marginLeft: 8 }
		}), /* @__PURE__ */ jsx("span", {
			style: {
				color: cssVar.colorTextDescription,
				flex: "none",
				fontSize: 12,
				marginRight: float ? 16 : 4
			},
			children: unsavedText
		})] }),
		children,
		enableReset && (float || hasUnsavedChanges) && /* @__PURE__ */ jsx(Button$1, {
			htmlType: "button",
			shape: float ? "round" : void 0,
			variant: "filled",
			onClick: () => {
				onReset?.(v, initialV);
				form?.resetFields();
			},
			...buttonProps,
			...resetButtonProps,
			children: resetText
		}),
		/* @__PURE__ */ jsx(Button$1, {
			htmlType: "submit",
			loading: submitLoading,
			shape: float ? "round" : void 0,
			type: "primary",
			...buttonProps,
			...saveButtonProps,
			children: submitText
		})
	] });
	if (!float) return /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: cx(styles.footer, className),
		gap: 8,
		justify: "flex-end",
		...rest,
		children: content
	});
	return /* @__PURE__ */ jsx(Motion.div, {
		animate: hasUnsavedChanges ? "visible" : "hidden",
		className: styles.floatFooter,
		initial: "hidden",
		transition: {
			duration: .1,
			ease: "easeOut"
		},
		variants: {
			hidden: {
				opacity: 0,
				x: "-50%",
				y: 20
			},
			visible: {
				opacity: 1,
				x: "-50%",
				y: 0
			}
		},
		children: /* @__PURE__ */ jsx(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className,
			gap: 8,
			justify: "center",
			...rest,
			children: content
		})
	});
});
FormSubmitFooter.displayName = "FormSubmitFooter";
//#endregion
export { FormSubmitFooter as default };

//# sourceMappingURL=FormSubmitFooter.mjs.map