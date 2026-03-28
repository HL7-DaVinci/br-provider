import type { QuestionnaireResponse } from "fhir/r4";
import { ClinicalTable } from "@/components/clinical-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEncounterQuestionnaireResponses } from "@/hooks/use-clinical-api";
import {
  formatClinicalDate,
  formatQuestionnaireName,
} from "@/lib/clinical-formatters";
import { bundleResources } from "@/lib/fhir-types";

interface EncounterDocumentationProps {
  encounterId: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  completed: "default",
  "in-progress": "secondary",
};

export function EncounterDocumentation({
  encounterId,
}: EncounterDocumentationProps) {
  const { data: bundle, isLoading } =
    useEncounterQuestionnaireResponses(encounterId);

  const responses = bundleResources(bundle);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Documentation</CardTitle>
      </CardHeader>
      <CardContent>
        <ClinicalTable<QuestionnaireResponse>
          loading={isLoading}
          keyExtractor={(qr) => qr.id ?? ""}
          emptyMessage="No documentation found for this encounter."
          columns={[
            {
              header: "Questionnaire",
              accessor: (qr) => (
                <span className="font-medium">
                  {formatQuestionnaireName(qr.questionnaire)}
                </span>
              ),
            },
            {
              header: "Status",
              accessor: (qr) => (
                <Badge
                  variant={STATUS_VARIANT[qr.status] ?? "outline"}
                  className="text-xs"
                >
                  {qr.status}
                </Badge>
              ),
            },
            {
              header: "Authored",
              accessor: (qr) => formatClinicalDate(qr.authored),
              className: "text-muted-foreground",
            },
          ]}
          data={responses}
        />
      </CardContent>
    </Card>
  );
}
