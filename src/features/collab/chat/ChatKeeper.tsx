import { useEffect } from "react";
import { startChat } from "./chat-store";

export function ChatKeeper() {
  useEffect(() => startChat(), []);
  return null;
}
