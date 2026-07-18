import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { ColorInput } from "@/components/ui/color-input";
import { cn } from "@/lib/utils";

export function ColorPicker({
  value,
  onChange,
  allowTransparent,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  allowTransparent?: boolean;
  ariaLabel: string;
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "size-7 cursor-pointer overflow-hidden rounded-full border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !value &&
              "bg-[length:8px_8px] bg-[linear-gradient(45deg,#ccc_25%,transparent_25%,transparent_75%,#ccc_75%,#ccc),linear-gradient(45deg,#ccc_25%,#fff_25%,#fff_75%,#ccc_75%,#ccc)] bg-[position:0_0,4px_4px]",
          )}
          style={value ? { backgroundColor: value } : undefined}
        />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 flex min-w-40 flex-col gap-2 rounded-md border bg-popover p-2 text-popover-foreground shadow-xl outline-none"
        >
          <ColorInput
            value={value || "#ffffff"}
            onChange={(event) => onChange(event.target.value)}
            aria-label={ariaLabel}
            className="size-8"
          />
          {allowTransparent && (
            <PopoverPrimitive.Close asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange("")}
                className="justify-start"
              >
                Transparent
              </Button>
            </PopoverPrimitive.Close>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
