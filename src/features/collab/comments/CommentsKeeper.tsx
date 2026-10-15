import { useEffect } from "react";
import { startComments } from "./comments-store";

export function CommentsKeeper() {
  useEffect(() => startComments(), []);
  return null;
}
