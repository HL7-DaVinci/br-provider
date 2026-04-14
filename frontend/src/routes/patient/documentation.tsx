import { createFileRoute, Link } from "@tanstack/react-router";
import type { Coverage, QuestionnaireResponse, Task } from "fhir/r4";
import {
  CheckCircle,
  ChevronLeft,
  ClipboardList,
  FileText,
  Loader2,
  Play,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import {
  useCoverage,
  usePatientQuestionnaireResponses,
} from "@/hooks/use-clinical-api";
import { useFhirServer } from "@/hooks/use-fhir-server";
import {
  extractTaskQuestionnaireUrls,
  usePatientDocumentationTasks,
} from "@/hooks/use-pas";
import { launchSmartApp } from "@/lib/api";
import {
  formatClinicalDate,
  formatQuestionnaireName,
} from "@/lib/clinical-formatters";
import { parseCoverageInfoFromResource } from "@/lib/coverage-extensions";

export const Route = createFileRoute("/patient/documentation")({
  component: DocumentationPage,
});

function DocumentationPage() {
  const { fhirUser } = useAuth();
  const patientId = fhirUser?.replace(/^Patient\//, "") ?? "";
  const { serverUrl: providerFhirUrl } = useFhirServer();

  const tasksQuery = usePatientDocumentationTasks(patientId, providerFhirUrl);
  const inProgressQuery = usePatientQuestionnaireResponses(
    patientId,
    "in-progress",
  );
  const completedQuery = usePatientQuestionnaireResponses(
    patientId,
    "completed",
  );
  const { data: coverageBundle } = useCoverage(patientId);

  const primaryCoverage = (coverageBundle?.entry ?? [])
    .map((e) => e.resource)
    .find((r): r is Coverage => r?.resourceType === "Coverage");
  const primaryCoverageRef = primaryCoverage?.id
    ? `Coverage/${primaryCoverage.id}`
    : undefined;

  const tasks = tasksQuery.data ?? [];
  const inProgress =
    inProgressQuery.data?.entry
      ?.map((e) => e.resource)
      .filter(
        (r): r is QuestionnaireResponse =>
          r?.resourceType === "QuestionnaireResponse",
      ) ?? [];
  const completed =
    completedQuery.data?.entry
      ?.map((e) => e.resource)
      .filter(
        (r): r is QuestionnaireResponse =>
          r?.resourceType === "QuestionnaireResponse",
      ) ?? [];

  const isLoading =
    tasksQuery.isLoading ||
    inProgressQuery.isLoading ||
    completedQuery.isLoading;
  const hasAny =
    tasks.length > 0 || inProgress.length > 0 || completed.length > 0;

  return (
    <div className="p-6 md:p-10 max-w-6xl space-y-6">
      <div className="flex items-center gap-2">
        <Link
          to="/patient"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Back to dashboard"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-semibold">Documentation</h1>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && !hasAny && (
        <p className="text-sm text-muted-foreground">
          No documentation on file. Forms will appear here when your insurer
          requests additional information for an appointment or order.
        </p>
      )}

      {tasks.length > 0 && (
        <TasksSection
          tasks={tasks}
          patientId={patientId}
          providerFhirUrl={providerFhirUrl}
          primaryCoverageRef={primaryCoverageRef}
        />
      )}

      {inProgress.length > 0 && (
        <InProgressSection
          responses={inProgress}
          patientId={patientId}
          providerFhirUrl={providerFhirUrl}
          primaryCoverageRef={primaryCoverageRef}
        />
      )}

      {completed.length > 0 && (
        <CompletedSection
          responses={completed}
          patientId={patientId}
          providerFhirUrl={providerFhirUrl}
          primaryCoverageRef={primaryCoverageRef}
        />
      )}
    </div>
  );
}

function TasksSection({
  tasks,
  patientId,
  providerFhirUrl,
  primaryCoverageRef,
}: {
  tasks: Task[];
  patientId: string;
  providerFhirUrl: string;
  primaryCoverageRef?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4 text-amber-600" />
          Forms to Complete
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              patientId={patientId}
              providerFhirUrl={providerFhirUrl}
              primaryCoverageRef={primaryCoverageRef}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TaskRow({
  task,
  patientId,
  providerFhirUrl,
  primaryCoverageRef,
}: {
  task: Task;
  patientId: string;
  providerFhirUrl: string;
  primaryCoverageRef?: string;
}) {
  const [isLaunching, setIsLaunching] = useState(false);
  const urls = extractTaskQuestionnaireUrls([task]);
  const label =
    task.description ||
    formatQuestionnaireName(urls[0]) ||
    "Documentation Request";
  const authored = formatClinicalDate(task.authoredOn);

  const handleStart = useCallback(async () => {
    if (urls.length === 0 || !task.id) return;
    setIsLaunching(true);
    try {
      const fhirContext = [primaryCoverageRef, `Task/${task.id}`].filter(
        (x): x is string => !!x,
      );
      await launchSmartApp({
        patientId,
        questionnaire: urls,
        providerFhirUrl,
        fhirContext,
      });
    } catch (err) {
      console.error("DTR launch failed:", err);
      toast.error("Failed to launch form");
    } finally {
      setIsLaunching(false);
    }
  }, [urls, task.id, patientId, providerFhirUrl, primaryCoverageRef]);

  return (
    <div className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium truncate">{label}</p>
        {authored && (
          <p className="text-xs text-muted-foreground">Requested {authored}</p>
        )}
      </div>
      <Button
        size="sm"
        onClick={handleStart}
        disabled={isLaunching || urls.length === 0}
      >
        {isLaunching ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <Play className="mr-1 h-3 w-3" />
        )}
        Start
      </Button>
    </div>
  );
}

function InProgressSection({
  responses,
  patientId,
  providerFhirUrl,
  primaryCoverageRef,
}: {
  responses: QuestionnaireResponse[];
  patientId: string;
  providerFhirUrl: string;
  primaryCoverageRef?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-blue-600" />
          In Progress
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          {responses.map((qr) => (
            <QrRow
              key={qr.id}
              qr={qr}
              actionLabel="Resume"
              patientId={patientId}
              providerFhirUrl={providerFhirUrl}
              primaryCoverageRef={primaryCoverageRef}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CompletedSection({
  responses,
  patientId,
  providerFhirUrl,
  primaryCoverageRef,
}: {
  responses: QuestionnaireResponse[];
  patientId: string;
  providerFhirUrl: string;
  primaryCoverageRef?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle className="h-4 w-4 text-green-600" />
          Completed
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          {responses.map((qr) => (
            <QrRow
              key={qr.id}
              qr={qr}
              actionLabel="View"
              patientId={patientId}
              providerFhirUrl={providerFhirUrl}
              primaryCoverageRef={primaryCoverageRef}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function QrRow({
  qr,
  actionLabel,
  patientId,
  providerFhirUrl,
  primaryCoverageRef,
}: {
  qr: QuestionnaireResponse;
  actionLabel: "Resume" | "View";
  patientId: string;
  providerFhirUrl: string;
  primaryCoverageRef?: string;
}) {
  const [isLaunching, setIsLaunching] = useState(false);
  const questionnaireUrl = qr.questionnaire;
  const label = formatQuestionnaireName(questionnaireUrl);
  const dateStr = qr.authored ?? qr.meta?.lastUpdated;
  const date = formatClinicalDate(dateStr);
  const datePrefix = actionLabel === "View" ? "Completed" : "Updated";

  const qrCoverageRef = parseCoverageInfoFromResource(qr).find(
    (ci) => ci.coverage,
  )?.coverage;
  const coverageRef = qrCoverageRef ?? primaryCoverageRef;

  const handleLaunch = useCallback(async () => {
    if (!qr.id || !questionnaireUrl) return;
    setIsLaunching(true);
    try {
      const fhirContext = [
        coverageRef,
        `QuestionnaireResponse/${qr.id}`,
      ].filter((x): x is string => !!x);
      await launchSmartApp({
        patientId,
        questionnaire: [questionnaireUrl],
        providerFhirUrl,
        fhirContext,
      });
    } catch (err) {
      console.error("DTR launch failed:", err);
      toast.error("Failed to open form");
    } finally {
      setIsLaunching(false);
    }
  }, [qr.id, questionnaireUrl, patientId, providerFhirUrl, coverageRef]);

  return (
    <div className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium truncate">{label}</p>
        {date && (
          <p className="text-xs text-muted-foreground">
            {datePrefix} {date}
          </p>
        )}
      </div>
      <Button
        variant={actionLabel === "View" ? "outline" : "default"}
        size="sm"
        onClick={handleLaunch}
        disabled={isLaunching || !questionnaireUrl}
      >
        {isLaunching ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : actionLabel === "View" ? (
          <CheckCircle className="mr-1 h-3 w-3" />
        ) : (
          <Play className="mr-1 h-3 w-3" />
        )}
        {actionLabel}
      </Button>
    </div>
  );
}
