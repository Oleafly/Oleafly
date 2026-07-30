import { staticStylish } from "../styles/theme/customStylishStatic.mjs";
import { createStaticStyles } from "antd-style";
import { cva } from "class-variance-authority";
//#region src/Snippet/style.ts
const styles = createStaticStyles(({ css, cssVar }) => {
	return {
		borderless: staticStylish.variantBorderlessWithoutHover,
		filled: staticStylish.variantFilledWithoutHover,
		hightlight: css`
      overflow: auto hidden;
      flex: 1;
      height: 100%;
      padding: 0;

      pre {
        display: flex;
        align-items: center;
        height: 100%;
      }
    `,
		outlined: staticStylish.variantOutlinedWithoutHover,
		root: css`
      position: relative;

      overflow: hidden;

      max-width: 100%;
      height: 38px;
      padding-block: 0;
      padding-inline: 12px 8px;
      border-radius: ${cssVar.borderRadius};
    `,
		shadow: staticStylish.shadow
	};
});
const variants = cva(styles.root, {
	defaultVariants: {
		shadow: false,
		variant: "filled"
	},
	variants: {
		variant: {
			filled: styles.filled,
			outlined: styles.outlined,
			borderless: styles.borderless
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