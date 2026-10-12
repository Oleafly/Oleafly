import { startLiveEditing } from "./live-editing";
import { startCollabLive } from "./live-store";

export function startLive(): () => void {
  return startCollabLive({ started: startLiveEditing });
}
