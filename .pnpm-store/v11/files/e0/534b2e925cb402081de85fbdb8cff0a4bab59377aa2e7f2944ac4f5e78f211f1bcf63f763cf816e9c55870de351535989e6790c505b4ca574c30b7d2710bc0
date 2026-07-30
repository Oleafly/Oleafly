import { SwitchChangeEventHandler, SwitchContextType, SwitchIconProps, SwitchRootProps, SwitchThumbProps } from "./type.mjs";
import { styles } from "./style.mjs";
//#region src/base-ui/Switch/atoms.d.ts
declare const useSwitchContext: () => SwitchContextType;
type SwitchRootInternalProps = Omit<SwitchRootProps, 'onCheckedChange' | 'onClick'> & {
  onCheckedChange?: SwitchChangeEventHandler;
  onClick?: SwitchChangeEventHandler;
};
declare const SwitchRoot: {
  ({ checked, className, defaultChecked, onCheckedChange, onClick, size, children, disabled, readOnly, required, inputRef, id, name, ...rest }: SwitchRootInternalProps): import("react").JSX.Element;
  displayName: string;
};
declare const SwitchThumb: {
  ({ className, pressedAnimation, size, transition, children, ...rest }: SwitchThumbProps): import("react").JSX.Element;
  displayName: string;
};
declare const SwitchIcon: {
  ({ children, className, position, size, transition, ...rest }: SwitchIconProps): import("react").JSX.Element;
  displayName: string;
};
//#endregion
export { SwitchIcon, SwitchRoot, SwitchThumb, styles as switchStyles, useSwitchContext };
//# sourceMappingURL=atoms.d.mts.map