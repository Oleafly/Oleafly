import { staticStylish } from "../styles/theme/customStylishStatic.mjs";
import { createStaticStyles, cx } from "antd-style";
import { cva } from "class-variance-authority";
//#region src/Input/style.ts
const styles = createStaticStyles(({ css, cssVar }) => {
	return {
		borderless: css`
      &[class*='ant-input'] {
        ${staticStylish.variantBorderless}
        &:hover {
          ${staticStylish.variantBorderlessWithoutHover}
        }
      }
    `,
		borderlessOPT: css`
      &[class*='ant-otp'] {
        [class*='ant-otp-input'] {
          ${staticStylish.variantBorderless};
        }
      }
    `,
		filled: cx(staticStylish.variantFilled, css`
        &:focus-within {
          ${staticStylish.variantFilledWithoutHover}
        }
      `),
		filledOPT: css`
      &[class*='ant-otp'] {
        [class*='ant-otp-input'] {
          ${staticStylish.variantFilled};
        }
      }
    `,
		outlined: staticStylish.variantOutlined,
		outlinedOPT: css`
      &[class*='ant-otp'] {
        [class*='ant-otp-input'] {
          ${staticStylish.variantOutlined};
        }
      }
    `,
		root: css``,
		rootOPT: css`
      &[class*='ant-otp'] {
        [class*='ant-otp-input'] {
          &:focus-within {
            border-color: ${cssVar.colorBorder};
          }
        }
      }
    `,
		shadow: staticStylish.shadow,
		shadowOPT: css`
      &[class*='ant-otp'] {
        [class*='ant-otp-input'] {
          ${staticStylish.shadow};
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
const variantsOPT = cva(styles.rootOPT, {
	defaultVariants: { shadow: false },
	variants: {
		variant: {
			filled: styles.filledOPT,
			outlined: styles.outlinedOPT,
			borderless: styles.borderlessOPT,
			underlined: null
		},
		shadow: {
			false: null,
			true: styles.shadowOPT
		}
	}
});
//#endregion
export { styles, variants, variantsOPT };

//# sourceMappingURL=style.mjs.map