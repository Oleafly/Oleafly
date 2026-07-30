import { styles as styles$1 } from "../DropdownMenu/sharedStyle.mjs";
import { createStaticStyles } from "antd-style";
//#region src/base-ui/AutoComplete/style.ts
const ownStyles = createStaticStyles(({ css, cssVar }) => ({
	clear: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    margin: 0;
    padding: 0;
    border: none;

    color: ${cssVar.colorTextTertiary};

    background: none;
    outline: none;

    transition: color 150ms ${cssVar.motionEaseOut};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
	empty: css`
    cursor: default;

    &:empty {
      display: none;
    }

    &:hover {
      background: transparent;
    }
  `,
	list: css`
    overflow-y: auto;
    max-height: min(320px, var(--available-height));

    &:empty {
      display: none;
    }
  `,
	popup: css`
    transform-origin: var(--transform-origin);
    width: var(--anchor-width);
    min-width: 0;
    transition:
      opacity 140ms ${cssVar.motionEaseOut},
      transform 140ms ${cssVar.motionEaseOut};

    &[data-starting-style],
    &[data-ending-style] {
      transform: scaleY(0.92);
      opacity: 0;
    }
  `
}));
const styles = {
	clear: ownStyles.clear,
	empty: [
		styles$1.item,
		styles$1.empty,
		ownStyles.empty
	].join(" "),
	item: styles$1.item,
	list: ownStyles.list,
	popup: [styles$1.popup, ownStyles.popup].join(" "),
	positioner: styles$1.positioner
};
//#endregion
export { styles };

//# sourceMappingURL=style.mjs.map