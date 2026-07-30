import { staticStylish } from "../../styles/theme/customStylishStatic.mjs";
import { createStaticStyles, cx } from "antd-style";
//#region src/List/ListItem/style.ts
const styles = createStaticStyles(({ css, cssVar }) => {
	return {
		actions: css`
      position: absolute;
      inset-block-start: 50%;
      inset-inline-end: 16px;
      transform: translateY(-50%);
    `,
		active: staticStylish.active,
		content: css`
      position: relative;
      overflow: hidden;
      flex: 1;
      align-self: center;
    `,
		date: css`
      font-size: 12px;
      color: ${cssVar.colorTextPlaceholder};
    `,
		desc: css`
      width: 100%;
      margin: 0;

      font-size: 12px;
      line-height: 1.2;
      color: ${cssVar.colorTextDescription};
    `,
		pin: css`
      position: absolute;
      inset-block-start: 6px;
      inset-inline-end: 6px;
    `,
		root: cx(staticStylish.variantBorderless, css`
        cursor: pointer;
        position: relative;
        border-radius: ${cssVar.borderRadius};
        color: ${cssVar.colorTextTertiary};
      `),
		title: css`
      width: 100%;
      margin: 0;

      font-size: 14px;
      font-weight: 500;
      line-height: 1.2;
      color: ${cssVar.colorText};
    `,
		triangle: css`
      width: 10px;
      height: 10px;
      border-radius: 2px;

      opacity: 0.5;
      background: ${cssVar.colorPrimaryBorder};
      clip-path: polygon(0% 0%, 100% 0%, 100% 100%);
    `
	};
});
//#endregion
export { styles };

//# sourceMappingURL=style.mjs.map