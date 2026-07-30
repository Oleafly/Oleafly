import { FlexboxProps } from "../../Flex/type.mjs";
import "../../Flex/index.mjs";
import { DivProps } from "../../types/index.mjs";
import { IconProps } from "../../Icon/type.mjs";
import "../../Icon/index.mjs";
import { TagProps } from "../../Tag/type.mjs";
import "../../Tag/index.mjs";
import { ButtonProps } from "../Button/type.mjs";
import "../Button/index.mjs";
import { CSSProperties, ComponentProps, ReactNode, Ref } from "react";
import { Field } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
//#region src/base-ui/Form/type.d.ts
type FormVariant = 'filled' | 'outlined' | 'borderless';
type FormLayout = 'horizontal' | 'vertical';
type ItemsType = 'group' | 'flat';
type FormValues = Record<string, any>;
type BaseFormProps = Omit<ComponentProps<typeof Form>, 'render' | 'className' | 'style'>;
interface FormProps extends BaseFormProps {
  activeKey?: (string | number)[];
  className?: string;
  classNames?: {
    group?: string;
    item?: string;
  };
  collapsible?: boolean;
  defaultActiveKey?: (string | number)[];
  footer?: ReactNode;
  gap?: number | string;
  /**
   * Initial values distributed to fields as `defaultValue` by name.
   * Also the baseline for unsaved-changes detection and native reset.
   */
  initialValues?: FormValues;
  itemMinWidth?: FormFieldProps['minWidth'];
  items?: FormGroupItemType[] | FormFieldProps[];
  itemsType?: ItemsType;
  layout?: FormLayout;
  onCollapse?: (key: (string | number)[]) => void;
  /**
   * Called with collected field values on submit. Async callbacks drive submit loading state.
   */
  onFinish?: (values: FormValues, eventDetails: Parameters<NonNullable<BaseFormProps['onFormSubmit']>>[1]) => void | Promise<void>;
  ref?: Ref<HTMLFormElement>;
  style?: CSSProperties;
  styles?: {
    group?: CSSProperties;
    item?: CSSProperties;
  };
  variant?: FormVariant;
}
interface FormFieldProps extends Omit<ComponentProps<typeof Field.Root>, 'render' | 'children' | 'className' | 'style'> {
  avatar?: ReactNode;
  children?: ReactNode;
  className?: string;
  desc?: ReactNode;
  divider?: boolean;
  hidden?: boolean;
  label?: ReactNode;
  layout?: FormLayout;
  minWidth?: string | number;
  required?: boolean;
  style?: CSSProperties;
  tag?: string;
  variant?: FormVariant;
}
interface FormGroupItemType {
  children: FormFieldProps[] | ReactNode;
  collapsible?: boolean;
  defaultActive?: boolean;
  desc?: ReactNode;
  extra?: ReactNode;
  icon?: IconProps['icon'];
  key?: string;
  title: ReactNode;
  variant?: FormVariant;
}
interface FormGroupProps extends Omit<DivProps, 'title'> {
  active?: boolean;
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
interface FormFlatGroupProps extends FlexboxProps {
  variant?: FormVariant;
}
interface FormDividerProps extends DivProps {
  visible?: boolean;
}
type FormFooterProps = FlexboxProps;
interface FormSubmitFooterProps extends Omit<FlexboxProps, 'onReset'> {
  buttonProps?: Omit<ButtonProps, 'children'>;
  enableReset?: boolean;
  enableUnsavedWarning?: boolean;
  float?: boolean;
  onReset?: () => void;
  resetButtonProps?: Omit<ButtonProps, 'children'>;
  saveButtonProps?: Omit<ButtonProps, 'children'>;
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
  tagProps?: Omit<TagProps, 'children'>;
  title: ReactNode;
}
interface FormContextValue {
  hasUnsavedChanges: boolean;
  initialValues?: FormValues;
  itemMinWidth?: FormFieldProps['minWidth'];
  layout: FormLayout;
  requestReset: () => void;
  submitLoading: boolean;
  variant: FormVariant;
}
//#endregion
export { FormContextValue, FormDividerProps, FormFieldProps, FormFlatGroupProps, FormFooterProps, FormGroupItemType, FormGroupProps, FormLayout, FormProps, FormSubmitFooterProps, FormTitleProps, FormValues, FormVariant, ItemsType };
//# sourceMappingURL=type.d.mts.map