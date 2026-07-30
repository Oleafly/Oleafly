import { macroTask } from "../hooks/useNotifyWatch";
import { raf } from '@rc-component/util';
export default async function delayFrame() {
  return new Promise(resolve => {
    macroTask(() => {
      raf(() => {
        resolve();
      });
    });
  });
}