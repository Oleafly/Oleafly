import { cn } from "@/lib/utils";

export function OleaflyAssistantMascot({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Oleafly AI assistant mascot"
      className={cn(
        "oleafly-assistant-mascot relative block size-28 shrink-0 select-none",
        className,
      )}
    >
      <img
        src="/oleafly-assistant.png"
        alt=""
        draggable={false}
        className="absolute inset-0 size-full object-contain drop-shadow-[0_7px_10px_rgb(0_0_0/0.18)]"
      />
      <img
        src="/oleafly-assistant-blink.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="oleafly-assistant-mascot-blink absolute inset-0 size-full object-contain drop-shadow-[0_7px_10px_rgb(0_0_0/0.18)]"
      />
    </span>
  );
}
