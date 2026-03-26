import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useOrderContext } from "@/hooks/use-order-context";

export function EncounterHeader() {
  const { state } = useOrderContext();
  const { encounter, patientId } = state;

  if (!encounter) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        <Activity className="h-4 w-4 animate-pulse" />
        Starting encounter...
      </div>
    );
  }

  const startTime = encounter.period?.start;
  const formattedStart = startTime
    ? new Date(startTime).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <Activity className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">Encounter</span>
      <Badge variant="secondary" className="text-xs">
        {encounter.status ?? "in-progress"}
      </Badge>
      <span className="text-muted-foreground">Patient/{patientId}</span>
      {formattedStart && (
        <span className="ml-auto text-xs text-muted-foreground">
          {formattedStart}
        </span>
      )}
    </div>
  );
}
