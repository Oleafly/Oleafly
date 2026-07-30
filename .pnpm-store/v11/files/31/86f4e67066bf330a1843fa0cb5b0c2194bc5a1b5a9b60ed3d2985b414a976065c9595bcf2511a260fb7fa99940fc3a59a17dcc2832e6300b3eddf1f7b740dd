import { fadeIn } from "../../styles/animations.mjs";
import { createStaticStyles } from "antd-style";
const styles = createStaticStyles(({ css }) => {
	return { animated: css`
      .stream-char {
        opacity: 0;

        animation-name: ${fadeIn};
        animation-duration: ${180}ms;
        animation-timing-function: cubic-bezier(0.33, 0, 0.67, 1);
        animation-fill-mode: forwards;
      }

      .stream-char-revealed {
        opacity: 1;
        animation: none;
      }

      .katex-display .katex-html span {
        mask: none !important;
        animation: none !important;
      }
    ` };
});
//#endregion
export { styles };

//# sourceMappingURL=style.mjs.map