import { ButtonProps } from "../Button/type.mjs";
import "../Button/index.mjs";
import { FormInstance, FormProps } from "../Form/type.mjs";
import "../Form/index.mjs";
import { ModalProps } from "../Modal/type.mjs";
import "../Modal/index.mjs";
import { Ref } from "react";
//#region src/FormModal/type.d.ts
type PickModalProps = Pick<ModalProps, 'style' | 'className' | 'allowFullscreen' | 'title' | 'width' | 'onCancel' | 'open' | 'centered' | 'destroyOnHidden' | 'paddings' | 'height' | 'enableResponsive' | 'afterClose' | 'afterOpenChange' | 'zIndex' | 'mask' | 'getContainer' | 'keyboard' | 'forceRender' | 'focusTriggerAfterClose' | 'closable' | 'loading' | 'closeIcon'>;
type PickFormProps = Omit<FormProps, 'className' | 'style' | 'title' | 'styles' | 'classNames'>;
interface FormModalProps extends PickModalProps, PickFormProps {
  classNames?: ModalProps['classNames'] & {
    form?: FormProps['className'];
  };
  onSubmit?: ModalProps['onOk'];
  ref?: Ref<FormInstance>;
  styles?: ModalProps['styles'] & {
    form?: FormProps['style'];
  };
  submitButtonProps?: ButtonProps;
  submitLoading?: ModalProps['confirmLoading'];
  submitText?: ModalProps['okText'];
}
//#endregion
export { FormModalProps };
//# sourceMappingURL=type.d.mts.map