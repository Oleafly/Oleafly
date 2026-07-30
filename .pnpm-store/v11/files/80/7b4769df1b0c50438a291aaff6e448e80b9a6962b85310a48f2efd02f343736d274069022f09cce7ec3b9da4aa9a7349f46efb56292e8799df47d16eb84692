import { staticStylish } from "../styles/theme/customStylishStatic.mjs";
import { createStaticStyles } from "antd-style";
import { cva } from "class-variance-authority";
//#region src/Button/style.ts
const styles = createStaticStyles(({ css, cssVar }) => {
	return {
		glass: staticStylish.blur,
		root: css`
      &[class*='ant-btn'] {
        > [class*='ant-btn-icon'] {
          display: flex;
        }
      }
    `,
		shadow: css`
      box-shadow: ${cssVar.boxShadowTertiary} !important;
    `
	};
});
const variants = cva(styles.root, {
	defaultVariants: {
		glass: false,
		shadow: false
	},
	variants: {
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