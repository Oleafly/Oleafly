import { useEffect } from "react";
import { startCollabActivity } from "./activity-feed";

export function CollabActivityKeeper() {
  useEffect(() => startCollabActivity(), []);
  return null;
}
