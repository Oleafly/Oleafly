import { useCallback, useEffect, useRef, useState } from "react";

export interface OverlayGate {
  open: boolean;
  setOpen: (next: boolean) => void;
}

export function useOverlayGate(
  setContentVisible: (visible: boolean) => Promise<void>,
): OverlayGate {
  const [open, setOpenState] = useState(false);
  const ticket = useRef(0);
  const openRef = useRef(false);

  const setOpen = useCallback(
    (next: boolean) => {
      const current = ++ticket.current;
      if (next) {
        void setContentVisible(false)
          .catch(() => {})
          .then(() => {
            if (ticket.current !== current) return;
            openRef.current = true;
            setOpenState(true);
          });
        return;
      }
      openRef.current = false;
      setOpenState(false);
      void setContentVisible(true).catch(() => {});
    },
    [setContentVisible],
  );

  useEffect(
    () => () => {
      if (openRef.current) void setContentVisible(true).catch(() => {});
    },
    [setContentVisible],
  );

  return { open, setOpen };
}
