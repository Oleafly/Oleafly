"use client";
import { styles } from "./style.mjs";
import { useMemo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/chat/LoadingDots/LoadingDots.tsx
const LoadingDots = ({ size = 8, color, variant = "dots", className, style }) => {
	const cssVariables = useMemo(() => {
		const vars = { "--loading-dots-size": `${size}px` };
		if (color) vars["--loading-dots-color"] = color;
		return vars;
	}, [color, size]);
	const renderDots = () => {
		switch (variant) {
			case "pulse": return /* @__PURE__ */ jsx("div", {
				className: styles.pulseDot,
				style: { animationDelay: "0s" }
			});
			case "wave": return /* @__PURE__ */ jsxs(Fragment$1, { children: [
				/* @__PURE__ */ jsx("div", {
					className: styles.waveDot,
					style: { animationDelay: "0s" }
				}),
				/* @__PURE__ */ jsx("div", {
					className: styles.waveDot,
					style: { animationDelay: "0.12s" }
				}),
				/* @__PURE__ */ jsx("div", {
					className: styles.waveDot,
					style: { animationDelay: "0.24s" }
				})
			] });
			case "orbit": return /* @__PURE__ */ jsxs("div", {
				className: styles.orbitContainer,
				children: [
					/* @__PURE__ */ jsx("div", {
						className: styles.orbitDot,
						style: { animationDelay: "0s" }
					}),
					/* @__PURE__ */ jsx("div", {
						className: styles.orbitDot,
						style: { animationDelay: "-0.4s" }
					}),
					/* @__PURE__ */ jsx("div", {
						className: styles.orbitDot,
						style: { animationDelay: "-0.8s" }
					})
				]
			});
			case "typing": return /* @__PURE__ */ jsxs(Fragment$1, { children: [
				/* @__PURE__ */ jsx("div", {
					className: styles.typingDot,
					style: { animationDelay: "0s" }
				}),
				/* @__PURE__ */ jsx("div", {
					className: styles.typingDot,
					style: { animationDelay: "0.15s" }
				}),
				/* @__PURE__ */ jsx("div", {
					className: styles.typingDot,
					style: { animationDelay: "0.3s" }
				})
			] });
			default: return /* @__PURE__ */ jsxs(Fragment$1, { children: [
				/* @__PURE__ */ jsx("div", {
					className: styles.defaultDot,
					style: { animationDelay: "0s" }
				}),
				/* @__PURE__ */ jsx("div", {
					className: styles.defaultDot,
					style: { animationDelay: "0.15s" }
				}),
				/* @__PURE__ */ jsx("div", {
					className: styles.defaultDot,
					style: { animationDelay: "0.3s" }
				})
			] });
		}
	};
	return /* @__PURE__ */ jsx("div", {
		className: cx(variant === "orbit" ? styles.orbitWrapper : styles.container, className),
		style: {
			...cssVariables,
			...style
		},
		children: renderDots()
	});
};
LoadingDots.displayName = "LoadingDots";
//#endregion
export { LoadingDots as default };

//# sourceMappingURL=LoadingDots.mjs.map