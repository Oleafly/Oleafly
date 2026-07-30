import { Trigger } from "../../types/trigger.mjs";
import "../../types/index.mjs";
import { Placement } from "../../utils/placement.mjs";
import { CSSProperties, ComponentPropsWithRef, ReactElement, ReactNode } from "react";
import { Popover, PopoverBackdropProps, PopoverPopupProps, PopoverPortalProps, PopoverPositionerProps, PopoverTriggerProps } from "@base-ui/react/popover";
//#region src/base-ui/Popover/type.d.ts
type PopoverPlacement = Placement;
type PopoverTrigger = Trigger;
/**
 * Base UI Positioner props that can be passed through
 */
type PopoverPositionerProps$1 = Omit<PopoverPositionerProps, 'className' | 'style' | 'children'>;
/**
 * Base UI Trigger props that can be passed through
 */
type PopoverTriggerComponentProps = Omit<PopoverTriggerProps, 'className' | 'style' | 'children' | 'render' | 'nativeButton' | 'handle' | 'payload'>;
/**
 * Base UI Popup props that can be passed through
 */
type PopoverPopupProps$1 = Omit<PopoverPopupProps, 'className' | 'style' | 'children'>;
/**
 * Base UI Backdrop props that can be passed through
 */
type PopoverBackdropProps$1 = Omit<PopoverBackdropProps, 'className' | 'style'>;
/**
 * Base UI Portal props that can be passed through
 */
type PopoverPortalProps$1 = Omit<PopoverPortalProps, 'children' | 'container'>;
interface PopoverProps {
  /**
   * 是否显示箭头
   * @default false
   */
  arrow?: boolean;
  /**
   * Base UI Backdrop 组件的 props
   */
  backdropProps?: PopoverBackdropProps$1;
  /**
   * 触发元素
   */
  children: ReactElement | ReactNode;
  /**
   * 弹出容器类名
   */
  className?: string;
  /**
   * 自定义类名
   */
  classNames?: {
    arrow?: string;
    content?: string;
    root?: string;
    trigger?: string;
  };
  /**
   * 关闭延迟（毫秒），优先级高于 mouseLeaveDelay
   */
  closeDelay?: number;
  /**
   * 弹出内容
   */
  content: ReactNode;
  /**
   * 默认打开状态
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * 是否禁用
   * @default false
   */
  disabled?: boolean;
  /**
   * 获取弹出容器
   */
  getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
  /**
   * 鼠标移入延迟（秒）
   * @default 0.1
   */
  mouseEnterDelay?: number;
  /**
   * 鼠标移出延迟（秒）
   * @default 0.1
   */
  mouseLeaveDelay?: number;
  /**
   * 是否使用原生 button 元素作为触发器
   */
  nativeButton?: boolean;
  /**
   * 打开状态变化回调
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * 受控的打开状态
   */
  open?: boolean;
  /**
   * 打开延迟（毫秒），优先级高于 mouseEnterDelay
   */
  openDelay?: number;
  /**
   * 弹出位置
   * @default 'top'
   */
  placement?: PopoverPlacement;
  /**
   * Base UI Popup 组件的 props
   */
  popupProps?: PopoverPopupProps$1;
  /**
   * Base UI Portal 组件的 props
   */
  portalProps?: PopoverPortalProps$1;
  /**
   * Base UI Positioner 组件的 props
   */
  positionerProps?: PopoverPositionerProps$1;
  /**
   * ref
   */
  ref?: ComponentPropsWithRef<typeof Popover.Trigger>['ref'];
  /**
   * 当设置为 true 时，即使在 PopoverGroup 内部也会独立渲染，忽略 group 单例行为
   */
  standalone?: boolean;
  /**
   * 自定义样式
   */
  styles?: {
    arrow?: CSSProperties;
    content?: CSSProperties;
    root?: CSSProperties;
  };
  /**
   * 触发方式
   * @default 'hover'
   */
  trigger?: Trigger;
  /**
   * Base UI Trigger 组件的 props
   */
  triggerProps?: PopoverTriggerComponentProps;
  /**
   * z-index
   */
  zIndex?: number;
}
//#endregion
export { PopoverBackdropProps$1 as PopoverBackdropProps, PopoverPlacement, PopoverPopupProps$1 as PopoverPopupProps, PopoverPortalProps$1 as PopoverPortalProps, PopoverPositionerProps$1 as PopoverPositionerProps, PopoverProps, PopoverTrigger, PopoverTriggerComponentProps };
//# sourceMappingURL=type.d.mts.map