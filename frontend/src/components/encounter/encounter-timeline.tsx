import { AlertCircle, Info, Radio, Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { type TimelineEvent, useOrderContext } from "@/hooks/use-order-context";
import { cn } from "@/lib/utils";

const TYPE_CONFIG: Record<
  TimelineEvent["type"],
  { icon: typeof Info; className: string }
> = {
  info: { icon: Info, className: "text-muted-foreground" },
  cds: { icon: Radio, className: "text-blue-500" },
  action: { icon: Zap, className: "text-amber-500" },
  error: { icon: AlertCircle, className: "text-destructive" },
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function EncounterTimeline() {
  const { state } = useOrderContext();
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(0);

  // Auto-scroll when new events are appended
  useEffect(() => {
    const currentCount = state.timelineEvents.length;
    if (currentCount > prevCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCount.current = currentCount;
  }, [state.timelineEvents.length]);

  if (state.timelineEvents.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No events yet.</p>;
  }

  return (
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {state.timelineEvents.map((event) => {
        const config = TYPE_CONFIG[event.type];
        const Icon = config.icon;
        const key = `${event.time.getTime()}-${event.type}-${event.message}`;
        return (
          <div key={key} className="flex items-start gap-1.5 text-xs">
            <Icon className={cn("h-3 w-3 mt-0.5 shrink-0", config.className)} />
            <span className="text-muted-foreground tabular-nums shrink-0">
              {formatTime(event.time)}
            </span>
            <span className="text-foreground">{event.message}</span>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
