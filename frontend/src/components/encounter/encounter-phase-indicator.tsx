import { Check } from "lucide-react";
import {
  type EncounterPhase,
  useOrderContext,
} from "@/hooks/use-order-context";
import { cn } from "@/lib/utils";

const PHASES: { key: EncounterPhase; label: string }[] = [
  { key: "start", label: "Start" },
  { key: "select", label: "Select Orders" },
  { key: "sign", label: "Sign" },
  { key: "summary", label: "Summary" },
];

const PHASE_INDEX: Record<EncounterPhase, number> = {
  start: 0,
  select: 1,
  sign: 2,
  summary: 3,
};

export function EncounterPhaseIndicator() {
  const { state } = useOrderContext();
  const currentIdx = PHASE_INDEX[state.currentPhase];

  return (
    <nav
      aria-label="Encounter progress"
      className="flex items-center gap-1 px-1 py-2"
    >
      {PHASES.map((phase, i) => {
        const isCompleted = i < currentIdx;
        const isCurrent = i === currentIdx;

        return (
          <div key={phase.key} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  "h-px w-6 mx-1",
                  isCompleted ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium shrink-0",
                  isCompleted && "bg-primary text-primary-foreground",
                  isCurrent && "border-2 border-primary text-primary",
                  !isCompleted &&
                    !isCurrent &&
                    "border border-border text-muted-foreground",
                )}
              >
                {isCompleted ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-xs whitespace-nowrap",
                  isCurrent
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {phase.label}
              </span>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
