import { FlexboxProps } from "../../Flex/type.mjs";
import "../../Flex/index.mjs";
import { ReactNode, Ref } from "react";
//#region src/mobile/TabBar/type.d.ts
interface TabBarItemType {
  icon: ReactNode | ((active: boolean) => ReactNode);
  key: string;
  onClick?: () => void;
  title: ReactNode | ((active: boolean) => ReactNode);
}
interface TabBarProps extends Omit<FlexboxProps, 'onChange'> {
  activeKey?: string;
  defaultActiveKey?: string;
  items: TabBarItemType[];
  onChange?: (key: string) => void;
  ref?: Ref<HTMLDivElement>;
  safeArea?: boolean;
}
//#endregion
export { TabBarItemType, TabBarProps };
//# sourceMappingURL=type.d.mts.map