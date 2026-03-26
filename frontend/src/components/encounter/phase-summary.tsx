import { Link } from "@tanstack/react-router";
import { CheckCircle, FileText, RotateCcw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrderContext } from "@/hooks/use-order-context";

interface PhaseSummaryProps {
  patientId: string;
  onExit?: () => void;
}

export function PhaseSummary({ patientId, onExit }: PhaseSummaryProps) {
  const { state, dispatch } = useOrderContext();
  const { selectedOrders, savedOrderIds, coverageInfo } = state;

  const needsDocs = coverageInfo.some(
    (info) => info.docNeeded && info.docNeeded !== "no-doc",
  );
  const needsAuth = coverageInfo.some(
    (info) => info.paNeeded === "auth-needed",
  );

  const handleNewEncounter = () => {
    dispatch({ type: "RESET" });
    onExit?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border bg-green-50 dark:bg-green-950/30 px-3 py-2">
        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
        <span className="text-sm font-medium">Encounter Complete</span>
      </div>

      {/* Signed Orders */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Signed Orders ({savedOrderIds.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {selectedOrders.map((order) => (
            <div
              key={order.templateId}
              className="flex items-center gap-2 text-sm"
            >
              <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
              <Badge variant="outline" className="font-mono text-xs shrink-0">
                {order.template.code}
              </Badge>
              <span className="truncate">{order.template.display}</span>
            </div>
          ))}
          {selectedOrders.length === 0 && (
            <p className="text-sm text-muted-foreground">No orders signed.</p>
          )}
        </CardContent>
      </Card>

      {/* Coverage and Auth Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>Documentation: </span>
            <Badge
              variant={needsDocs ? "secondary" : "outline"}
              className="text-xs"
            >
              {needsDocs ? "Required" : "Not required"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>Prior Authorization: </span>
            <Badge
              variant={needsAuth ? "secondary" : "outline"}
              className="text-xs"
            >
              {needsAuth ? "Required" : "Not required"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex gap-2">
        <Link
          to="/patients/$patientId"
          params={{ patientId }}
          className="flex-1"
        >
          <Button variant="outline" className="w-full">
            Return to Patient Chart
          </Button>
        </Link>
        <Button
          variant="outline"
          className="flex-1"
          onClick={handleNewEncounter}
        >
          <RotateCcw className="h-4 w-4 mr-1.5" />
          Start New Encounter
        </Button>
      </div>
    </div>
  );
}
