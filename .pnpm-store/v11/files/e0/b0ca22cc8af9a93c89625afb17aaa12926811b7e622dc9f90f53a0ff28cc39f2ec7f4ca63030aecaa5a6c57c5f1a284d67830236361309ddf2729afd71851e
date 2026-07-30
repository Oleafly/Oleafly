import { FlexboxProps } from "../Flex/type.mjs";
import "../Flex/index.mjs";
import { DivProps } from "../types/index.mjs";
import { IconProps } from "../Icon/type.mjs";
import "../Icon/index.mjs";
import { ButtonProps as ButtonProps$1 } from "../Button/type.mjs";
import "../Button/index.mjs";
import { CollapseProps as CollapseProps$1 } from "../Collapse/type.mjs";
import "../Collapse/index.mjs";
import { TagProps as TagProps$1 } from "../Tag/type.mjs";
import "../Tag/index.mjs";
import { CSSProperties, ReactNode, Ref } from "react";
import { DividerProps, FormInstance, FormInstance as FormInstance$1, FormProps } from "antd";
import { FormItemProps } from "antd/es/form/FormItem/index.js";
//#region src/Form/type.d.ts
type FormVariant = 'filled' | 'outlined' | 'borderless';
type ItemsType = 'group' | 'flat';
interface FormProps$1 extends Omit<FormProps, 'variant' | 'styles' | 'classNames'> {
  activeKey?: (string | number)[];
  children?: ReactNode;
  classNames?: FormGroupProps['classNames'] & {
    group?: string;
    item?: string;
  };
  collapsible?: boolean;
  defaultActiveKey?: (string | number)[];
  footer?: ReactNode;
  gap?: number | string;
  itemMinWidth?: FormItemProps$1['minWidth'];
  items?: FormGroupItemType[] | FormItemProps$1[];
  itemsType?: ItemsType;
  itemVariant?: FormProps['variant'];
  onCollapse?: (key: (string | number)[]) => void;
  ref?: Ref<FormInstance>;
  styles?: FormGroupProps['styles'] & {
    group?: CSSProperties;
    item?: CSSProperties;
  };
  variant?: FormVariant;
}
interface FormDividerProps extends DividerProps {
  visible?: boolean;
}
interface FormFlatGroupProps extends FlexboxProps {
  variant?: FormVariant;
}
type FormFooterProps = DivProps;
interface FormGroupItemType {
  children: FormItemProps$1[] | ReactNode;
  collapsible?: boolean;
  defaultActive?: boolean;
  desc?: ReactNode;
  extra?: ReactNode;
  icon?: IconProps['icon'];
  key?: string;
  title: ReactNode;
  variant?: FormVariant;
}
interface FormGroupProps extends Omit<CollapseProps$1, 'collapsible' | 'items' | 'defaultActiveKey' | 'activeKey' | 'variant'> {
  active?: boolean;
  children: ReactNode;
  collapsible?: boolean;
  defaultActive?: boolean;
  desc?: ReactNode;
  extra?: ReactNode;
  icon?: IconProps['icon'];
  keyValue?: string | number;
  onCollapse?: (active: boolean) => void;
  title?: ReactNode;
  variant?: FormVariant;
}
interface FormItemProps$1 extends FormItemProps {
  avatar?: FormTitleProps['avatar'];
  desc?: FormTitleProps['desc'];
  divider?: boolean;
  hidden?: boolean;
  minWidth?: string | number;
  tag?: FormTitleProps['tag'];
  variant?: FormVariant;
}
interface FormSubmitFooterProps extends Omit<FlexboxProps, 'onReset'> {
  buttonProps?: Omit<ButtonProps$1, 'children'>;
  children?: ReactNode;
  enableReset?: boolean;
  enableUnsavedWarning?: boolean;
  float?: boolean;
  onReset?: (value: any, preValue: any) => void;
  resetButtonProps?: Omit<ButtonProps$1, 'children'>;
  saveButtonProps?: Omit<ButtonProps$1, 'children'>;
  texts?: {
    reset?: string;
    submit?: string;
    unSaved?: string;
    unSavedWarning?: string;
  };
}
interface FormTitleProps extends Omit<FlexboxProps, 'title'> {
  avatar?: ReactNode;
  classNames?: {
    content?: string;
    desc?: string;
    tag?: string;
    title?: string;
  };
  desc?: ReactNode;
  styles?: {
    content?: CSSProperties;
    desc?: CSSProperties;
    tag?: CSSProperties;
    title?: CSSProperties;
  };
  tag?: string;
  tagProps?: Omit<TagProps$1, 'children'>;
  title: ReactNode;
}
//#endregion
export { FormDividerProps, FormFlatGroupProps, FormFooterProps, FormGroupItemType, FormGroupProps, type FormInstance$1 as FormInstance, FormItemProps$1 as FormItemProps, FormProps$1 as FormProps, FormSubmitFooterProps, FormTitleProps, FormVariant, ItemsType };
//# sourceMappingURL=type.d.mts.map