"use client";
import { variants } from "./style.mjs";
import FormGroup from "./components/FormGroup.mjs";
import FormItem from "./components/FormItem.mjs";
import { FormProvider } from "./components/FormProvider.mjs";
import FormFlatGroup from "./components/FormFlatGroup.mjs";
import { memo, useCallback, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Form } from "antd";
import { cx, useResponsive } from "antd-style";
import { isUndefined } from "es-toolkit/compat";
//#region src/Form/Form.tsx
const Form$1 = memo(({ className, itemMinWidth, footer, form, items = [], children, itemsType = "group", itemVariant, variant = "borderless", classNames, styles: customStyles, gap, style, collapsible, defaultActiveKey, initialValues, activeKey, onCollapse, onFinish, ref, layout, ...rest }) => {
	const { mobile } = useResponsive();
	const [submitLoading, setSubmitLoading] = useState(false);
	const mapFlat = useCallback((item, itemIndex) => /* @__PURE__ */ jsx(FormItem, {
		className: classNames?.item,
		divider: itemIndex !== 0,
		minWidth: itemMinWidth,
		style: customStyles?.item,
		variant,
		...item
	}, itemIndex), [
		itemMinWidth,
		variant,
		classNames,
		customStyles
	]);
	const mapTree = useCallback((group, groupIndex) => {
		const key = group?.key || groupIndex;
		return /* @__PURE__ */ jsx(FormGroup, {
			active: activeKey && group?.key ? activeKey.includes(key) : void 0,
			className: classNames?.group,
			classNames,
			collapsible: isUndefined(group.collapsible) ? collapsible : group.collapsible,
			extra: group?.extra,
			icon: group?.icon,
			keyValue: key,
			style: customStyles?.group,
			styles: customStyles,
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
		customStyles
	]);
	return /* @__PURE__ */ jsx(FormProvider, {
		config: {
			form,
			initialValues,
			submitLoading
		},
		children: /* @__PURE__ */ jsxs(Form, {
			className: cx(variants({ variant }), className),
			colon: false,
			form,
			initialValues,
			layout: layout || (mobile ? "vertical" : "horizontal"),
			ref,
			variant: itemVariant,
			style: {
				gap,
				...style
			},
			onFinish: async (...finishProps) => {
				if (!onFinish) return;
				setSubmitLoading(true);
				await onFinish(...finishProps);
				setSubmitLoading(false);
			},
			...rest,
			children: [
				items && items?.length > 0 ? itemsType === "group" ? items?.map((item, i) => mapTree(item, i)) : /* @__PURE__ */ jsx(FormFlatGroup, {
					className: classNames?.group,
					style: customStyles?.group,
					variant,
					children: items?.filter((item) => !item.hidden).map((item, i) => mapFlat(item, i))
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