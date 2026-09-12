import "i18next";
import type { Resources } from "./resources-types";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    enableSelector: "strict";
    strictKeyChecks: true;
    resources: Resources;
  }
}
