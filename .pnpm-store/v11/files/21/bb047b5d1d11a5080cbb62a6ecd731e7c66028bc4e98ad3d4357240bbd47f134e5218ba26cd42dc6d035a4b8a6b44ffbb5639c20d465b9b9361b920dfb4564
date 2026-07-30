"use client";
import A from "../../A/index.mjs";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Center from "../../Flex/Center.mjs";
import Button$1 from "../../Button/Button.mjs";
import AuroraBackground from "../AuroraBackground/AuroraBackground.mjs";
import GradientButton from "../GradientButton/GradientButton.mjs";
import GithubIcon from "../../icons/lucideExtra/GithubIcon.mjs";
import { styles } from "./style.mjs";
import { memo, useCallback } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { ConfigProvider } from "antd";
import { useResponsive } from "antd-style";
//#region src/awesome/Hero/Hero.tsx
const Hero = memo(({ title, description, actions, Link }) => {
	const { mobile } = useResponsive();
	const LinkRender = Link || A;
	const ButtonGroups = useCallback(() => Boolean(actions?.length) && /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		className: styles.actions,
		gap: 16,
		justify: "center",
		children: actions.map(({ text, link, openExternal, github, type }, index) => {
			const content = type === "primary" ? /* @__PURE__ */ jsx(GradientButton, {
				block: mobile,
				icon: github ? GithubIcon : void 0,
				size: "large",
				children: text
			}, index) : /* @__PURE__ */ jsx(Button$1, {
				block: mobile,
				icon: github ? GithubIcon : void 0,
				size: "large",
				type: "primary",
				children: text
			}, index);
			return openExternal ? /* @__PURE__ */ jsx(A, {
				href: link,
				target: openExternal ? "_blank" : void 0,
				children: content
			}, text) : /* @__PURE__ */ jsx(LinkRender, {
				to: link,
				children: content
			}, text);
		})
	}), [actions]);
	return /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsx(AuroraBackground, {}), /* @__PURE__ */ jsx(ConfigProvider, {
		theme: { token: { fontSize: 16 } },
		children: /* @__PURE__ */ jsx(FlexBasic_default, {
			align: "center",
			style: { zIndex: 1 },
			children: /* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				className: styles.container,
				distribution: "center",
				children: /* @__PURE__ */ jsxs(Center, { children: [
					title && /* @__PURE__ */ jsx(Center, {
						horizontal: true,
						as: "h1",
						className: styles.title,
						dangerouslySetInnerHTML: { __html: title },
						gap: "0.25em",
						wrap: "wrap"
					}),
					description && /* @__PURE__ */ jsx("p", {
						className: styles.desc,
						dangerouslySetInnerHTML: { __html: description }
					}),
					/* @__PURE__ */ jsx(ButtonGroups, {})
				] })
			})
		})
	})] });
});
Hero.displayName = "Hero";
//#endregion
export { Hero as default };

//# sourceMappingURL=Hero.mjs.map