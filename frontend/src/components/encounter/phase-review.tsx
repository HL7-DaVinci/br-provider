import { Link } from "@tanstack/react-router";
import { CheckCircle, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useOrderContext } from "@/hooks/use-order-context";
import { EncounterLinkedOrders } from "./encounter-linked-orders";

interface PhaseReviewProps {
  patientId: string;
  encounterId: string;
  onFinish: () => Promise<void>;
  onDispatch: () => Promise<void>;
}

export function PhaseReview({
  patientId,
  encounterId,
  onFinish,
  onDispatch,
}: PhaseReviewProps) {
  const { state } = useOrderContext();
  const [isFinishing, setIsFinishing] = useState(false);

  const handleFinish = useCallback(async () => {
    setIsFinishing(true);
    try {
      await onFinish();
    } finally {
      setIsFinishing(false);
    }
  }, [onFinish]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border bg-green-50 dark:bg-green-950/30 px-3 py-2">
        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
        <span className="text-sm font-medium">
          {state.selectedOrders.length} order(s) signed — review coverage and
          complete any required documentation
        </span>
      </div>

      <EncounterLinkedOrders
        encounterId={encounterId}
        patientId={patientId}
        onDispatch={onDispatch}
      />

      <div className="flex gap-2">
        <Link
          to="/patients/$patientId"
          params={{ patientId }}
          className="flex-1"
        >
          <Button variant="outline" className="w-full">
            Back to Patient Chart
          </Button>
        </Link>
        <Button
          className="flex-1"
          onClick={handleFinish}
          disabled={isFinishing}
        >
          {isFinishing ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4 mr-1.5" />
          )}
          {isFinishing ? "Finishing..." : "Finish Encounter"}
        </Button>
      </div>
    </div>
  );
}
