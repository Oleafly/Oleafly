import { LanguageServiceKeeper } from "./LanguageServiceKeeper";
import { LanguageServiceStatus } from "./LanguageServiceStatus";

/**
 * Keeps the always-on language-service lifecycle and its status UI in one
 * on-demand chunk. The boundary starts loading this module during the first
 * application render, while the rest of the app can paint independently.
 */
export function LanguageServiceRuntime() {
  return (
    <>
      <LanguageServiceKeeper />
      <LanguageServiceStatus />
    </>
  );
}
