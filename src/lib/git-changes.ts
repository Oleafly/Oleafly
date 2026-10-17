import type { GitFileChange } from "@oleafly/backend-port";

export const sameGitChanges = (
  a: readonly GitFileChange[],
  b: readonly GitFileChange[],
): boolean =>
  a.length === b.length &&
  a.every(
    (change, index) =>
      change.path === b[index]?.path &&
      change.status === b[index]?.status &&
      change.staged === b[index]?.staged &&
      change.conflict === b[index]?.conflict,
  );
