import { Check, ExternalLink, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  CdsCard as CdsCardType,
  CdsLink,
  CdsSuggestion,
} from "@/lib/cds-types";
import { cn } from "@/lib/utils";

interface CdsCardProps {
  card: CdsCardType;
  onApplySuggestion?: (suggestion: CdsSuggestion) => void;
  onSmartLaunch?: (link: CdsLink) => void;
  appliedSuggestions?: Set<string>;
}

const INDICATOR_STYLES = {
  info: "border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20",
  warning: "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20",
  critical: "border-l-red-500 bg-red-50/50 dark:bg-red-950/20",
} as const;

const INDICATOR_BADGE_STYLES = {
  info: "bg-blue-600 text-white border-blue-600",
  warning: "bg-amber-500 text-white border-amber-500",
  critical: "bg-red-600 text-white border-red-600",
} as const;

export function CdsCard({
  card,
  onApplySuggestion,
  onSmartLaunch,
  appliedSuggestions,
}: CdsCardProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-l-4 p-3 text-sm",
        INDICATOR_STYLES[card.indicator],
      )}
    >
      {/* Header: indicator badge + summary */}
      <div className="flex items-start gap-2">
        <Badge
          className={cn("shrink-0", INDICATOR_BADGE_STYLES[card.indicator])}
        >
          {card.indicator}
        </Badge>
        <p className="font-medium leading-snug">{card.summary}</p>
      </div>

      {/* Detail text */}
      {card.detail && (
        <p className="mt-1.5 text-muted-foreground leading-relaxed">
          {card.detail}
        </p>
      )}

      {/* Source attribution */}
      {card.source && (
        <p className="mt-2 text-xs text-muted-foreground">
          Source:{" "}
          {card.source.url ? (
            <a
              href={card.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              {card.source.label}
            </a>
          ) : (
            card.source.label
          )}
        </p>
      )}

      {/* Suggestions */}
      {card.suggestions && card.suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.suggestions.map((suggestion) => {
            const suggestionKey = suggestion.uuid ?? suggestion.label;
            const isApplied = appliedSuggestions?.has(suggestionKey) ?? false;
            return (
              <Button
                key={suggestionKey}
                variant={suggestion.isRecommended ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                disabled={isApplied}
                onClick={() => onApplySuggestion?.(suggestion)}
              >
                {isApplied ? (
                  <Check className="mr-1 h-3 w-3" />
                ) : (
                  <Lightbulb className="mr-1 h-3 w-3" />
                )}
                {suggestion.label}
              </Button>
            );
          })}
        </div>
      )}

      {/* Links */}
      {card.links && card.links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {card.links.map((link) =>
            link.type === "smart" ? (
              <Button
                key={link.url}
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onSmartLaunch?.(link)}
              >
                <ExternalLink className="mr-1 h-3 w-3" />
                {link.label}
              </Button>
            ) : (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary underline hover:text-primary/80"
              >
                <ExternalLink className="h-3 w-3" />
                {link.label}
              </a>
            ),
          )}
        </div>
      )}
    </div>
  );
}
