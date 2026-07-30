import { staticStylish } from "../styles/theme/customStylishStatic.mjs";
import { createStaticStyles } from "antd-style";
import { cva } from "class-variance-authority";
//#region src/Segmented/style.ts
const styles = createStaticStyles(({ css, cssVar }) => {
	return {
		borderless: staticStylish.variantBorderlessWithoutHover,
		filled: css`
      border: 1px solid ${cssVar.colorFillQuaternary};
      background: ${cssVar.colorBgLayout};
    `,
		glass: staticStylish.blur,
		outlined: css`
      border: 1px solid ${cssVar.colorBorderSecondary};
      background: transparent;
    `,
		root: css``,
		shadow: staticStylish.shadow
	};
});
const variants = cva(styles.root, {
	defaultVariants: {
		glass: false,
		shadow: false,
		variant: "filled"
	},
	variants: {
		variant: {
			filled: styles.filled,
			outlined: styles.outlined,
			borderless: styles.borderless
		},
		glass: {
			false: null,
			true: styles.glass
		},
		shadow: {
			false: null,
			true: styles.shadow
		}
	}
});
//#endregion
export { styles, variants };

//# sourceMappingURL=style.mjs.map