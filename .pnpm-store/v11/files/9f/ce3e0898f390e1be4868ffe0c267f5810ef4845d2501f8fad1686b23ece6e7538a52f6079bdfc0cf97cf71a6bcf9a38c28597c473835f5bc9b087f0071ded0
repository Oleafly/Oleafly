import { staticStylish } from "../styles/theme/customStylishStatic.mjs";
import { createStaticStyles } from "antd-style";
import { cva } from "class-variance-authority";
//#region src/AutoComplete/style.ts
const styles = createStaticStyles(({ css }) => {
	return {
		borderless: css`
      &[class*='ant-select'] {
        > [class*='ant-select-selector'] {
          ${staticStylish.variantBorderless}
        }
      }
    `,
		filled: css`
      &[class*='ant-select'] {
        > [class*='ant-select-selector'] {
          ${staticStylish.variantFilled}
        }
      }
    `,
		outlined: css`
      &[class*='ant-select'] {
        > [class*='ant-select-selector'] {
          ${staticStylish.variantOutlined}
        }
      }
    `,
		root: css``,
		shadow: css`
      &[class*='ant-select'] {
        > [class*='ant-select-selector'] {
          ${staticStylish.shadow}
        }
      }
    `
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