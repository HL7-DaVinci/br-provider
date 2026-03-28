import { CheckCircle2, Clock, FileText, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useEncounterOrders,
  useEncounterQuestionnaireResponses,
} from "@/hooks/use-clinical-api";
import { useOrderContext } from "@/hooks/use-order-context";
import { formatDuration } from "@/lib/clinical-formatters";
import { bundleResources } from "@/lib/fhir-types";

interface EncounterSummaryPanelProps {
  encounterId: string;
  patientId: string;
}

export function EncounterSummaryPanel({
  encounterId,
  patientId,
}: EncounterSummaryPanelProps) {
  const { state } = useOrderContext();
  const { data: orders } = useEncounterOrders(encounterId, patientId);
  const { data: qrBundle } = useEncounterQuestionnaireResponses(encounterId);

  const orderCount = orders?.length ?? 0;
  const responses = bundleResources(qrBundle);
  const completedDocs = responses.filter(
    (qr) => qr.status === "completed",
  ).length;
  const duration = formatDuration(
    state.encounter?.period?.start,
    state.encounter?.period?.end,
  );

  const rows = [
    { icon: ShoppingCart, label: "Orders signed", value: orderCount },
    { icon: FileText, label: "Documentation completed", value: completedDocs },
    { icon: Clock, label: "Duration", value: duration },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          Encounter Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between text-sm"
          >
            <span className="flex items-center gap-2 text-muted-foreground">
              <row.icon className="h-3.5 w-3.5" />
              {row.label}
            </span>
            <span className="font-medium">{row.value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
