import { staticStylish } from "../styles/theme/customStylishStatic.mjs";
import { createStaticStyles } from "antd-style";
import { cva } from "class-variance-authority";
//#region src/DatePicker/style.ts
const styles = createStaticStyles(({ css }) => {
	return {
		borderless: staticStylish.variantBorderless,
		filled: staticStylish.variantFilled,
		outlined: staticStylish.variantOutlined,
		root: css``,
		shadow: staticStylish.shadow
	};
});
const variants = cva(styles.root, {
	defaultVariants: { shadow: false },
	variants: {
		variant: {
			filled: styles.filled,
			outlined: styles.outlined,
			borderless: styles.borderless,
			underlined: null
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