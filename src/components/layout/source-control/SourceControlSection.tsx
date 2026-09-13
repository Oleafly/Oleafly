import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function SourceControlSection({
	id,
	title,
	menuLabel,
	count,
	open,
	onOpenChange,
	menu,
	children,
	className,
}: {
	id: string;
	title: string;
	menuLabel?: string;
	count?: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	menu?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	const contentId = `${id}-content`;
	return (
		<section
			data-testid={id}
			className={cn("border-b border-sidebar-border/70", className)}
		>
			<div className="group flex min-h-8 items-center gap-1 px-2">
				<button
					type="button"
					aria-expanded={open}
					aria-controls={contentId}
					onClick={() => onOpenChange(!open)}
					className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-0.5 py-1 text-left text-xs font-semibold tracking-wide text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					{open ? (
						<ChevronDown aria-hidden className="size-3.5 shrink-0" />
					) : (
						<ChevronRight aria-hidden className="size-3.5 shrink-0" />
					)}
					<span className="truncate">{title}</span>
					{typeof count === "number" ? (
						<span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
							{count}
						</span>
					) : null}
				</button>
				{menu ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
								aria-label={menuLabel ?? title}
							>
								<MoreHorizontal className="size-3.5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">{menu}</DropdownMenuContent>
					</DropdownMenu>
				) : null}
			</div>
			<div id={contentId} hidden={!open} className="pb-1">
				{open ? children : null}
			</div>
		</section>
	);
}
