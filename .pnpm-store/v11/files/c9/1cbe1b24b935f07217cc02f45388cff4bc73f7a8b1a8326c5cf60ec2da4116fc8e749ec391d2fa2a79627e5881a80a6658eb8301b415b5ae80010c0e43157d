import { SMOOTH_CORNER_MASKS } from "../utils/smoothCorners.mjs";
import { createStaticStyles } from "antd-style";
import { cva } from "class-variance-authority";
//#region src/GroupAvatar/style.ts
const styles = createStaticStyles(({ css }) => {
	const createCornerVariant = (cornerType) => css`
    mask-image: url('${SMOOTH_CORNER_MASKS[cornerType]}');
    mask-position: center;
    mask-repeat: no-repeat;
    mask-size: 100% 100%;
  `;
	return {
		circle: createCornerVariant("circle"),
		ios: createCornerVariant("ios"),
		root: css`
      overflow: hidden;
      flex: none;

      /* Fallback for browsers without mask support */
      border-radius: 15%;

      /* Apply smooth corners mask with fallback */
      @supports (mask-image: url('data:image/svg+xml;base64,')) {
        border-radius: 0;
      }
    `,
		sharp: createCornerVariant("sharp"),
		smooth: createCornerVariant("smooth"),
		square: createCornerVariant("square"),
		squircle: createCornerVariant("squircle")
	};
});
const variants = cva(styles.root, {
	defaultVariants: { cornerShape: "squircle" },
	variants: { cornerShape: {
		circle: styles.circle,
		ios: styles.ios,
		sharp: styles.sharp,
		smooth: styles.smooth,
		square: styles.square,
		squircle: styles.squircle
	} }
});
//#endregion
export { styles, variants };

//# sourceMappingURL=style.mjs.map