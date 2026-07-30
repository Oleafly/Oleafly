import { staticStylish } from "../styles/theme/customStylishStatic.mjs";
import { createStaticStyles, cx } from "antd-style";
//#region src/ImageSelect/styles.ts
const styles = createStaticStyles(({ css, cssVar }) => {
	return {
		active: css`
      color: ${cssVar.colorText};
    `,
		container: css`
      cursor: pointer;
      color: ${cssVar.colorTextDescription};
    `,
		img: cx(staticStylish.variantFilled, css`
        border-radius: ${cssVar.borderRadius};

        &:hover {
          box-shadow: 0 0 0 2px ${cssVar.colorText};
        }
      `),
		imgActive: cx(staticStylish.active, css`
        box-shadow: 0 0 0 2px ${cssVar.colorTextTertiary};
      `)
	};
});
//#endregion
export { styles };

//# sourceMappingURL=styles.mjs.map