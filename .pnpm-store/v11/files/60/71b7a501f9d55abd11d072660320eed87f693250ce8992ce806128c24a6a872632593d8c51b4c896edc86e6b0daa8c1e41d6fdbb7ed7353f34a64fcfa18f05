import { staticStylish } from "../styles/theme/customStylishStatic.mjs";
import { createStaticStyles } from "antd-style";
import { cva } from "class-variance-authority";
//#region src/GuideCard/style.ts
const styles = createStaticStyles(({ css, cssVar }) => ({
	borderless: staticStylish.variantBorderlessWithoutHover,
	close: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline-end: 8px;
  `,
	content: css`
    padding: 16px;
  `,
	cover: css`
    align-self: center;
  `,
	desc: css`
    color: ${cssVar.colorTextDescription};
  `,
	filledDark: css`
    ${staticStylish.variantFilledWithoutHover};
    background: linear-gradient(
      to bottom,
      ${cssVar.colorFillTertiary},
      ${cssVar.colorFillQuaternary}
    );
  `,
	filledLight: css`
    ${staticStylish.variantFilledWithoutHover};
    background: linear-gradient(
      to bottom,
      ${cssVar.colorFillQuaternary},
      ${cssVar.colorFillTertiary}
    );
  `,
	outlined: staticStylish.variantOutlinedWithoutHover,
	root: css`
    position: relative;
    overflow: hidden;
    border-radius: ${cssVar.borderRadiusLG};
  `,
	shadow: staticStylish.shadow,
	title: css`
    font-size: 16px;
    font-weight: bold;
  `
}));
const variants = cva(styles.root, {
	compoundVariants: [{
		class: styles.filledDark,
		isDarkMode: true,
		variant: "filled"
	}, {
		class: styles.filledLight,
		isDarkMode: false,
		variant: "filled"
	}],
	defaultVariants: {
		isDarkMode: false,
		shadow: false,
		variant: "filled"
	},
	variants: {
		isDarkMode: {
			false: null,
			true: null
		},
		shadow: {
			false: null,
			true: styles.shadow
		},
		variant: {
			borderless: styles.borderless,
			filled: null,
			outlined: styles.outlined
		}
	}
});
//#endregion
export { styles, variants };

//# sourceMappingURL=style.mjs.map