import { staticStylish } from "../styles/theme/customStylishStatic.mjs";
import { createStaticStyles } from "antd-style";
import { cva } from "class-variance-authority";
//#region src/SortableList/style.ts
const styles = createStaticStyles(({ css, cssVar }) => {
	return {
		borderless: staticStylish.variantBorderlessWithoutHover,
		container: css`
      padding: 0;
      list-style: none;
    `,
		filled: staticStylish.variantFilledWithoutHover,
		item: css`
      overflow: hidden;
      box-sizing: border-box;
      border-radius: ${cssVar.borderRadius};
      list-style: none;
    `,
		itemVariant: css`
      padding-block: 4px;
      padding-inline: 4px 16px;
    `,
		outlined: staticStylish.variantOutlinedWithoutHover
	};
});
const variants = cva(styles.item, {
	compoundVariants: [{
		className: styles.itemVariant,
		variant: "outlined"
	}, {
		className: styles.itemVariant,
		variant: "filled"
	}],
	defaultVariants: { variant: "borderless" },
	variants: { variant: {
		filled: styles.filled,
		outlined: styles.outlined,
		borderless: styles.borderless
	} }
});
//#endregion
export { styles, variants };

//# sourceMappingURL=style.mjs.map