import { Context, ReactNode } from "react";
import * as m from "motion/react-m";
//#region src/MotionProvider/index.d.ts
type MotionComponentType = typeof import('motion/react').motion | typeof m;
declare const MotionComponent: Context<MotionComponentType>;
declare const MotionProvider: import("react").NamedExoticComponent<{
  children: ReactNode;
  motion: MotionComponentType;
}>;
declare const useMotionComponent: () => MotionComponentType;
//#endregion
export { MotionComponent, MotionComponentType, MotionProvider, useMotionComponent };
//# sourceMappingURL=index.d.mts.map