import { createStaticStyles } from "antd-style";
//#region src/mdx/Callout/style.ts
const styles = createStaticStyles(({ css }) => {
	return {
		container: css`
      --lobe-markdown-margin-multiple: 1;

      overflow: hidden;
      gap: 0.75em;

      margin-block: calc(var(--lobe-markdown-margin-multiple) * 1em);
      padding-block: calc(var(--lobe-markdown-margin-multiple) * 1em);
      padding-inline: 1em;
      border-radius: calc(var(--lobe-markdown-border-radius) * 1px);
    `,
		content: css`
      margin-block: calc(var(--lobe-markdown-margin-multiple) * -1em);

      > div {
        margin-block: calc(var(--lobe-markdown-margin-multiple) * 1em);
      }

      p {
        color: inherit !important;
      }
    `,
		underlineAnchor: css`
      a {
        text-decoration: underline;
      }
    `
	};
});
//#endregion
export { styles };

//# sourceMappingURL=style.mjs.map