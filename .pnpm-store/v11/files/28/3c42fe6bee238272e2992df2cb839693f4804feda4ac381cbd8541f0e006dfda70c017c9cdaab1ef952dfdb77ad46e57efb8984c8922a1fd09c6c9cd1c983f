import { root } from 'getroot';

/**
 * Naïvely detect if running environment if node
 * Note this'll return true on Electron's renderer process as well
 */
export const isNode = () => {
  const proc = root.process;

  if (!!proc && typeof proc === 'object') {
    if (!!proc.versions && typeof proc.versions === 'object') {
      if (typeof proc.versions.node !== 'undefined') {
        return true;
      }
    }
  }
  return false;
};
