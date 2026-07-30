"use client";
import A from "../../A/index.mjs";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Block from "../../Block/Block.mjs";
import Icon from "../../Icon/Icon.mjs";
import Img from "../../Img/index.mjs";
import Tag from "../../Tag/Tag.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { createStaticStyles, cx } from "antd-style";
//#region src/mdx/Cards/Card.tsx
const styles = createStaticStyles(({ css, cssVar }) => {
	return {
		card: css`
      --lobe-markdown-header-multiple: 0.2;
      --lobe-markdown-margin-multiple: 1;

      overflow: hidden;
      height: 100%;
      color: ${cssVar.colorText};

      h3,
      p {
        margin-block: 0 !important;
      }

      p {
        color: ${cssVar.colorTextDescription};
        transition: color 0.2s ${cssVar.motionEaseInOut};
      }

      &:hover {
        p {
          color: ${cssVar.colorTextSecondary};
        }

        .mdx-card-icon {
          opacity: 1;
        }
      }
    `,
		content: css`
      width: 100%;
      padding: 1.4em;
    `,
		icon: css`
      margin-block: 0.1em;
      opacity: 0.5;
      transition: opacity 0.2s ${cssVar.motionEaseInOut};
    `
	};
});
const Card = ({ tag, tagColor = "blue", icon, title, desc, href, iconProps, className, image, variant = "filled", ...rest }) => {
	return /* @__PURE__ */ jsx(A, {
		href,
		children: /* @__PURE__ */ jsxs(Block, {
			clickable: true,
			align: "flex-start",
			className: cx(styles.card, className),
			variant,
			...rest,
			children: [
				image && /* @__PURE__ */ jsx(Img, {
					alt: title,
					height: 100,
					src: image,
					style: {
						height: "auto",
						width: "100%"
					},
					width: 250
				}),
				tag && /* @__PURE__ */ jsx(FlexBasic_default, {
					align: "flex-start",
					className: styles.content,
					style: {
						paddingBottom: "0.2em",
						paddingTop: "1.8em"
					},
					children: /* @__PURE__ */ jsx(Tag, {
						color: tagColor,
						style: {
							borderRadius: "1em",
							fontSize: "0.8em",
							fontWeight: 500,
							paddingBlock: "0.1em",
							paddingInline: "0.6em"
						},
						children: tag
					})
				}),
				/* @__PURE__ */ jsxs(FlexBasic_default, {
					horizontal: true,
					align: desc ? "flex-start" : "center",
					className: styles.content,
					gap: "0.75em",
					children: [!image && icon && /* @__PURE__ */ jsx(Icon, {
						className: cx(styles.icon, "mdx-card-icon"),
						icon,
						size: { size: "1.5em" },
						...iconProps
					}), /* @__PURE__ */ jsxs(FlexBasic_default, {
						gap: "0.2em",
						children: [/* @__PURE__ */ jsx("h3", { children: title }), desc && /* @__PURE__ */ jsx("p", { children: desc })]
					})]
				})
			]
		})
	});
};
Card.displayName = "MdxCard";
//#endregion
export { Card as default };

//# sourceMappingURL=Card.mjs.map