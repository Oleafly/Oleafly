import { staticStylish } from "../styles/theme/customStylishStatic.mjs";
import { createStaticStyles } from "antd-style";
import { cva } from "class-variance-authority";
//#region src/ActionIconGroup/style.ts
const styles = createStaticStyles(({ css, cssVar }) => {
	return {
		borderless: staticStylish.variantBorderless,
		disabled: staticStylish.disabled,
		filled: staticStylish.variantFilledWithoutHover,
		glass: staticStylish.blur,
		outlined: staticStylish.variantOutlinedWithoutHover,
		root: css`
      position: relative;
      border-radius: ${cssVar.borderRadius};
    `,
		shadow: staticStylish.shadow
	};
});
const variants = cva(styles.root, {
	defaultVariants: {
		disabled: false,
		glass: false,
		shadow: false,
		variant: "outlined"
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
		},
		disabled: {
			false: null,
			true: styles.disabled
		}
	}
});
//#endregion
export { styles, variants };

//# sourceMappingURL=style.mjs.map