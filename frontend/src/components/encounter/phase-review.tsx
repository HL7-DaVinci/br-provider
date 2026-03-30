import { Link } from "@tanstack/react-router";
import { CheckCircle, Loader2, ShieldCheck, ShieldPlus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useOrderPaStatusMap } from "@/hooks/use-clinical-api";
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
  const paStatusMap = useOrderPaStatusMap(patientId);
  const [isFinishing, setIsFinishing] = useState(false);

  const handleFinish = useCallback(async () => {
    setIsFinishing(true);
    try {
      await onFinish();
    } finally {
      setIsFinishing(false);
    }
  }, [onFinish]);

  const pipelineCounts = useMemo(() => {
    const ci = state.coverageInfo;
    const covered = ci.filter((c) => c.covered === "covered").length;
    const needsAuth = ci.filter((c) => c.paNeeded === "auth-needed").length;
    let authSubmitted = 0;
    for (const order of state.selectedOrders) {
      if (!order.serverId) continue;
      const key = `${order.template.resourceType}/${order.serverId}`;
      if (paStatusMap.has(key)) authSubmitted++;
    }
    return {
      covered,
      needsAuth,
      authSubmitted,
      total: state.selectedOrders.length,
    };
  }, [state.coverageInfo, state.selectedOrders, paStatusMap]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border bg-green-50 dark:bg-green-950/30 px-3 py-2">
        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
        <span className="text-sm font-medium">
          {state.selectedOrders.length} order(s) signed — review coverage and
          complete any required documentation
        </span>
      </div>

      {pipelineCounts.total > 0 && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground px-1">
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="tabular">{pipelineCounts.covered}</span>/
            <span className="tabular">{pipelineCounts.total}</span> covered
          </span>
          <span className="flex items-center gap-1">
            <ShieldPlus className="h-3.5 w-3.5" />
            <span className="tabular">{pipelineCounts.authSubmitted}</span>/
            <span className="tabular">{pipelineCounts.needsAuth}</span> auth
            submitted
          </span>
        </div>
      )}

      <EncounterLinkedOrders
        encounterId={encounterId}
        patientId={patientId}
        paStatusMap={paStatusMap}
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
