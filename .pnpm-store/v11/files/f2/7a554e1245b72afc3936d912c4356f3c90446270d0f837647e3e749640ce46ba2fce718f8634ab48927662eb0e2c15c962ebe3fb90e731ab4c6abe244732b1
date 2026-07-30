import * as React from 'react';
import { BaseUIComponentProps } from "../../internals/types.js";
import type { AvatarRootState, ImageLoadingStatus } from "../root/AvatarRoot.js";
import { type TransitionStatus } from "../../internals/useTransitionStatus.js";
/**
 * The image to be displayed in the avatar.
 * Renders an `<img>` element.
 *
 * Documentation: [Base UI Avatar](https://base-ui.com/react/components/avatar)
 */
export declare const AvatarImage: React.ForwardRefExoticComponent<Omit<AvatarImageProps, "ref"> & React.RefAttributes<HTMLImageElement>>;
export interface AvatarImageState extends AvatarRootState {
  /**
   * The transition status of the component.
   */
  transitionStatus: TransitionStatus;
}
export interface AvatarImageProps extends BaseUIComponentProps<'img', AvatarImageState> {
  /**
   * Callback fired when the loading status changes.
   */
  onLoadingStatusChange?: ((status: ImageLoadingStatus) => void) | undefined;
}
export declare namespace AvatarImage {
  type State = AvatarImageState;
  type Props = AvatarImageProps;
}