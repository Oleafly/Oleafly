"use client";
import { rootVariants } from "./style.mjs";
import { FormContext } from "./context.mjs";
import FormField from "./components/FormField.mjs";
import FormFlatGroup from "./components/FormFlatGroup.mjs";
import FormGroup from "./components/FormGroup.mjs";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useResponsive } from "antd-style";
import { isUndefined } from "es-toolkit/compat";
import { Form } from "@base-ui/react/form";
//#region src/base-ui/Form/Form.tsx
const serializeForm = (form) => {
	if (!form) return "";
	const entries = [...new FormData(form).entries()].filter(([, value]) => typeof value === "string");
	return JSON.stringify(entries.sort((a, b) => a[0].localeCompare(b[0])));
};
const Form$1 = memo(({ className, itemMinWidth, footer, items = [], children, itemsType = "group", variant = "borderless", classNames, styles: customStyles, gap, style, collapsible, defaultActiveKey, initialValues, activeKey, onCollapse, onFinish, onFormSubmit, layout, ref, ...rest }) => {
	const { mobile } = useResponsive();
	const formRef = useRef(null);
	const [submitLoading, setSubmitLoading] = useState(false);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const snapshotRef = useRef("");
	const syncUnsaved = useCallback(() => {
		setHasUnsavedChanges(serializeForm(formRef.current) !== snapshotRef.current);
	}, []);
	useEffect(() => {
		const form = formRef.current;
		if (!form) return;
		snapshotRef.current = serializeForm(form);
		let resetTimer;
		const handleMutation = () => syncUnsaved();
		const handleReset = () => {
			resetTimer = setTimeout(() => {
				snapshotRef.current = serializeForm(formRef.current);
				syncUnsaved();
			}, 0);
		};
		form.addEventListener("input", handleMutation);
		form.addEventListener("change", handleMutation);
		form.addEventListener("reset", handleReset);
		return () => {
			clearTimeout(resetTimer);
			form.removeEventListener("input", handleMutation);
			form.removeEventListener("change", handleMutation);
			form.removeEventListener("reset", handleReset);
		};
	}, [syncUnsaved]);
	const requestReset = useCallback(() => {
		formRef.current?.reset();
	}, []);
	const mergedRef = useCallback((node) => {
		formRef.current = node;
		if (typeof ref === "function") ref(node);
		else if (ref) ref.current = node;
	}, [ref]);
	const context = useMemo(() => ({
		hasUnsavedChanges,
		initialValues,
		itemMinWidth,
		layout: layout || (mobile ? "vertical" : "horizontal"),
		requestReset,
		submitLoading,
		variant
	}), [
		hasUnsavedChanges,
		initialValues,
		itemMinWidth,
		layout,
		mobile,
		requestReset,
		submitLoading,
		variant
	]);
	const mapFlat = useCallback((item, itemIndex) => /* @__PURE__ */ jsx(FormField, {
		className: classNames?.item,
		divider: itemIndex !== 0,
		style: customStyles?.item,
		variant,
		...item
	}, itemIndex), [
		variant,
		classNames,
		customStyles
	]);
	const mapTree = useCallback((group, groupIndex) => {
		const key = group?.key || groupIndex;
		return /* @__PURE__ */ jsx(FormGroup, {
			active: activeKey && group?.key ? activeKey.includes(key) : void 0,
			className: classNames?.group,
			collapsible: isUndefined(group.collapsible) ? collapsible : group.collapsible,
			desc: group?.desc,
			extra: group?.extra,
			icon: group?.icon,
			style: customStyles?.group,
			title: group.title,
			variant: group?.variant || variant,
			defaultActive: defaultActiveKey && group?.key ? defaultActiveKey.includes(key) : group?.defaultActive,
			onCollapse: (active) => {
				let keys = activeKey || defaultActiveKey || [];
				keys = keys.filter((k) => k !== key);
				onCollapse?.(active ? [...keys, key] : keys);
			},
			children: Array.isArray(group.children) ? group.children.filter((item) => !item.hidden).map((item, i) => mapFlat(item, i)) : group.children
		}, key);
	}, [
		activeKey,
		collapsible,
		defaultActiveKey,
		onCollapse,
		variant,
		classNames,
		customStyles,
		mapFlat
	]);
	return /* @__PURE__ */ jsx(FormContext, {
		value: context,
		children: /* @__PURE__ */ jsxs(Form, {
			className: cx(rootVariants({ variant }), className),
			ref: mergedRef,
			style: {
				gap,
				...style
			},
			onFormSubmit: async (values, eventDetails) => {
				onFormSubmit?.(values, eventDetails);
				if (!onFinish) return;
				setSubmitLoading(true);
				try {
					await onFinish(values, eventDetails);
					snapshotRef.current = serializeForm(formRef.current);
					syncUnsaved();
				} finally {
					setSubmitLoading(false);
				}
			},
			...rest,
			children: [
				items && items.length > 0 ? itemsType === "group" ? items.map((item, i) => mapTree(item, i)) : /* @__PURE__ */ jsx(FormFlatGroup, {
					className: classNames?.group,
					style: customStyles?.group,
					variant,
					children: items.filter((item) => !item.hidden).map((item, i) => mapFlat(item, i))
				}) : void 0,
				children,
				footer
			]
		})
	});
});
Form$1.displayName = "Form";
//#endregion
export { Form$1 as default };

//# sourceMappingURL=Form.mjs.map