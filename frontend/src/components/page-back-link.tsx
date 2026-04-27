import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageBackLinkProps extends Omit<LinkProps, "children" | "className"> {
  label: string;
  className?: string;
}

export function PageBackLink({
  label,
  className,
  ...linkProps
}: PageBackLinkProps) {
  return (
    <Link
      {...linkProps}
      className={cn(
        "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors",
        className,
      )}
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}
