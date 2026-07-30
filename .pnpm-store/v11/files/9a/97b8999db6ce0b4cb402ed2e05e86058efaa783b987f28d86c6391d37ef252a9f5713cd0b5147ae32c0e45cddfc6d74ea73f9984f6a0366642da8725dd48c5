import { BlockProps } from "../Block/type.mjs";
import { AvatarProps } from "../Avatar/type.mjs";
import { SMOOTH_CORNER_MASKS } from "../utils/smoothCorners.mjs";
import { Ref } from "react";
//#region src/GroupAvatar/type.d.ts
type AvatarItem = string | Omit<AvatarProps, 'size'>;
interface GroupAvatarProps extends Omit<BlockProps, 'width' | 'height' | 'variant'> {
  avatars?: AvatarItem[];
  avatarShape?: AvatarProps['shape'];
  cornerShape?: keyof typeof SMOOTH_CORNER_MASKS;
  grid?: 2 | 3 | 'auto';
  ref?: Ref<HTMLDivElement>;
  size?: number;
}
//#endregion
export { GroupAvatarProps };
//# sourceMappingURL=type.d.mts.map