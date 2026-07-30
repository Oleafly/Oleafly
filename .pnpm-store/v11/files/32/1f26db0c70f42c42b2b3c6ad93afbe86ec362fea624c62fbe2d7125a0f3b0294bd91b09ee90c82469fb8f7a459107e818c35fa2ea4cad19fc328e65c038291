import { CSSProperties, ComponentProps, ReactNode, Ref } from "react";
import { Tabs } from "@base-ui/react/tabs";
//#region src/base-ui/Tabs/type.d.ts
type TabsVariant = 'rounded' | 'square' | 'point';
type TabsSize = 'small' | 'middle' | 'large';
type TabsOrientation = 'horizontal' | 'vertical';
interface TabsClassNames {
  indicator?: string;
  list?: string;
  panel?: string;
  root?: string;
  tab?: string;
}
interface TabsStyles {
  indicator?: CSSProperties;
  list?: CSSProperties;
  panel?: CSSProperties;
  root?: CSSProperties;
  tab?: CSSProperties;
}
interface TabsItem {
  children?: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  key: string;
  label: ReactNode;
}
type TabsRootProps = Omit<ComponentProps<typeof Tabs.Root>, 'className' | 'render'> & {
  className?: string;
};
type TabsListProps = Omit<ComponentProps<typeof Tabs.List>, 'className' | 'render'> & {
  className?: string;
  variant?: TabsVariant;
};
type TabsTabProps = Omit<ComponentProps<typeof Tabs.Tab>, 'className' | 'render'> & {
  className?: string;
  size?: TabsSize;
  variant?: TabsVariant;
};
type TabsPanelProps = Omit<ComponentProps<typeof Tabs.Panel>, 'className' | 'render'> & {
  className?: string;
};
type TabsIndicatorProps = Omit<ComponentProps<typeof Tabs.Indicator>, 'className' | 'render'> & {
  className?: string;
  variant?: TabsVariant;
};
interface TabsProps {
  activeKey?: string;
  className?: string;
  classNames?: TabsClassNames;
  defaultActiveKey?: string;
  items?: TabsItem[];
  onChange?: (key: string) => void;
  orientation?: TabsOrientation;
  ref?: Ref<HTMLDivElement>;
  size?: TabsSize;
  style?: CSSProperties;
  styles?: TabsStyles;
  variant?: TabsVariant;
}
//#endregion
export { TabsClassNames, TabsIndicatorProps, TabsItem, TabsListProps, TabsOrientation, TabsPanelProps, TabsProps, TabsRootProps, TabsSize, TabsStyles, TabsTabProps, TabsVariant };
//# sourceMappingURL=type.d.mts.map