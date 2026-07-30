import { TranslationResourcesInput } from "../i18n/types.mjs";
import { MotionComponentType } from "../MotionProvider/index.mjs";
import { CDN, CdnApi } from "../utils/genCdnUrl.mjs";
import { ElementType, ReactNode } from "react";
//#region src/ConfigProvider/index.d.ts
interface Config {
  aAs?: ElementType;
  customCdnFn?: CdnFn;
  imgAs?: ElementType;
  imgUnoptimized?: boolean;
  proxy?: CDN | 'custom';
}
interface ConfigProviderProps {
  children: ReactNode;
  config?: Config;
  locale?: string;
  motion: MotionComponentType;
  resources?: TranslationResourcesInput;
}
declare const ConfigProvider: import("react").NamedExoticComponent<ConfigProviderProps>;
type CdnFn = ({ pkg, version, path }: CdnApi) => string;
declare const useCdnFn: () => CdnFn;
//#endregion
export { CdnFn, Config, ConfigProviderProps, ConfigProvider as default, useCdnFn };
//# sourceMappingURL=index.d.mts.map