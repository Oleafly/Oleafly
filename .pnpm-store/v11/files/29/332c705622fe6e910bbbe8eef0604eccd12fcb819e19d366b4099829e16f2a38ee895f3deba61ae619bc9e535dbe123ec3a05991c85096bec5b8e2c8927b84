"use client";
import Icon from "../../Icon/Icon.mjs";
import { useToastContext } from "./context.mjs";
import { actionVariants, rootVariants, styles } from "./style.mjs";
import { memo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cssVar, cx } from "antd-style";
import { AlertTriangle, CheckCircle, Info, Loader2, X, XCircle } from "lucide-react";
import { Toast } from "@base-ui/react/toast";
//#region src/base-ui/Toast/Toast.tsx
const typeIcons = {
	default: Info,
	error: XCircle,
	info: Info,
	loading: Loader2,
	success: CheckCircle,
	warning: AlertTriangle
};
const typeColors = {
	default: cssVar.colorText,
	error: cssVar.colorError,
	info: cssVar.colorInfo,
	loading: cssVar.colorPrimary,
	success: cssVar.colorSuccess,
	warning: cssVar.colorWarning
};
const ToastItem = memo(({ toast, classNames, styles: customStyles }) => {
	const { position, swipeDirection } = useToastContext();
	const toastData = toast.data;
	const type = toastData?.type ?? "default";
	const closable = toastData?.closable ?? true;
	const hideCloseButton = toastData?.hideCloseButton ?? false;
	const showCloseButton = closable && !hideCloseButton;
	const icon = toastData?.icon;
	const title = toast.title ?? toastData?.title;
	const description = toast.description ?? toastData?.description;
	const actionProps = toast.actionProps ?? toastData?.actionProps;
	const actions = toastData?.actions;
	const iconColor = typeColors[type];
	const IconComponent = icon ?? typeIcons[type];
	const isLoading = type === "loading";
	const standaloneDescriptionClassName = cx(styles.description, styles.descriptionStandalone, classNames?.description);
	const renderIcon = () => {
		if (!IconComponent) return null;
		return /* @__PURE__ */ jsx("div", {
			className: cx(styles.icon, classNames?.icon),
			style: customStyles?.icon,
			children: /* @__PURE__ */ jsx(Icon, {
				color: iconColor,
				icon: IconComponent,
				size: 18,
				spin: isLoading
			})
		});
	};
	const renderActions = () => {
		if (actions && actions.length > 0) return /* @__PURE__ */ jsx("div", {
			className: cx(styles.actions, classNames?.actions),
			style: customStyles?.actions,
			children: actions.map((action, index) => /* @__PURE__ */ jsx(Toast.Action, {
				style: customStyles?.action,
				className: cx(actionVariants({ variant: action.variant ?? "primary" }), classNames?.action),
				onClick: action.onClick,
				...action.props,
				children: action.label
			}, index))
		});
		if (actionProps) return /* @__PURE__ */ jsx(Toast.Action, {
			className: cx(actionVariants({ variant: "primary" }), classNames?.action),
			style: customStyles?.action,
			...actionProps
		});
		return null;
	};
	return /* @__PURE__ */ jsx(Toast.Root, {
		className: cx(rootVariants({ position }), classNames?.root),
		swipeDirection,
		toast,
		style: {
			...customStyles?.root,
			...toastData?.style
		},
		children: /* @__PURE__ */ jsx(Toast.Content, {
			className: cx(styles.content, classNames?.content),
			style: customStyles?.content,
			children: /* @__PURE__ */ jsxs("div", {
				className: title ? styles.toastBody : styles.toastBodyCenter,
				children: [renderIcon(), /* @__PURE__ */ jsxs("div", {
					className: styles.contentArea,
					children: [title ? /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsxs("div", {
						className: styles.titleRow,
						children: [/* @__PURE__ */ jsx(Toast.Title, {
							className: cx(styles.title, classNames?.title),
							style: customStyles?.title,
							children: title
						}), showCloseButton && /* @__PURE__ */ jsx(Toast.Close, {
							"aria-label": "Close",
							className: cx(styles.close, classNames?.close),
							style: customStyles?.close,
							children: /* @__PURE__ */ jsx(X, { size: 14 })
						})]
					}), description && /* @__PURE__ */ jsx(Toast.Description, {
						className: cx(styles.description, classNames?.description),
						style: {
							marginBlockStart: 4,
							...customStyles?.description
						},
						children: description
					})] }) : description && /* @__PURE__ */ jsxs("div", {
						className: styles.titleRow,
						children: [/* @__PURE__ */ jsx(Toast.Description, {
							className: standaloneDescriptionClassName,
							style: customStyles?.description,
							children: description
						}), showCloseButton && /* @__PURE__ */ jsx(Toast.Close, {
							"aria-label": "Close",
							className: cx(styles.close, classNames?.close),
							style: customStyles?.close,
							children: /* @__PURE__ */ jsx(X, { size: 14 })
						})]
					}), renderActions()]
				})]
			})
		})
	});
});
ToastItem.displayName = "ToastItem";
//#endregion
export { ToastItem as default };

//# sourceMappingURL=Toast.mjs.map