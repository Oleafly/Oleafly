import { LanguageServiceKeeper } from "./LanguageServiceKeeper";
import { LanguageServiceStatus } from "./LanguageServiceStatus";

export function LanguageServiceRuntime() {
  return (
    <>
      <LanguageServiceKeeper />
      <LanguageServiceStatus />
    </>
  );
}
