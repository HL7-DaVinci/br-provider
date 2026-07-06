import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Coverage, QuestionnaireResponse, Task } from "fhir/r4";
import { ExternalLink, Eye, Loader2, Play, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { CompletedQrViewer } from "@/components/dtr/completed-qr-viewer";
import { useLaunchDtrForTask } from "@/components/dtr/use-dtr-task-sheet";
import { useTaskSheet } from "@/components/task-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSubmitAttachment } from "@/hooks/use-cdex";
import {
  useCoverage,
  useOrderPaStatus,
  useOrderQuestionnaireResponses,
  usePatient,
} from "@/hooks/use-clinical-api";
import { fhirFetch } from "@/hooks/use-fhir-api";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { useCompleteDocumentationTask } from "@/hooks/use-pas";
import { usePayerServer } from "@/hooks/use-payer-server";
import {
  formatClinicalDate,
  formatPatientName,
  formatQuestionnaireName,
} from "@/lib/clinical-formatters";
import { selectNewCompletedQrs } from "@/lib/qr-status";
import {
  isTerminalTaskStatus,
  taskAttachmentLabels,
  taskKind,
  taskPayerLabel,
  taskQuestionnaireLabel,
  taskTypeLabel,
  taskWaitingSummary,
} from "@/lib/task-worklist";

const STATUS_BADGES: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    className?: string;
  }
> = {
  completed: {
    label: "Completed",
    variant: "default",
    className: "bg-green-600",
  },
  "in-progress": {
    label: "In progress",
    variant: "secondary",
    className: "bg-amber-500 text-white",
  },
  failed: { label: "Failed", variant: "destructive" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
  "entered-in-error": { label: "Entered in error", variant: "outline" },
};

export function TaskStatusBadge({ status }: { status: string | undefined }) {
  const config = STATUS_BADGES[status ?? ""] ?? {
    label: status ?? "Unknown",
    variant: "outline" as const,
  };
  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
}

interface TaskDetailSheetProps {
  task: Task;
  /**
   * Whether a $submit-attachment from this sheet closes out the last open
   * documentation request for the order (CDex Final flag). The worklist
   * computes this from sibling open doc Tasks sharing the order.
   */
  isFinalAttachment?: boolean;
}

function refsOfType(task: Task, resourceType: string): string[] {
  return (task.output ?? [])
    .map((output) => output.valueReference?.reference)
    .filter((ref): ref is string => !!ref?.startsWith(`${resourceType}/`));
}

export function TaskDetailSheet({
  task,
  isFinalAttachment = true,
}: TaskDetailSheetProps) {
  const { serverUrl: providerFhirUrl } = useFhirServer();
  const { fhirUrl: payerFhirUrl } = usePayerServer();
  const { closeTaskSheet } = useTaskSheet();

  const patientId = task.for?.reference?.split("/").pop() ?? "";
  const orderRef = task.focus?.reference;
  const trackingId = task.identifier?.[0]?.value;
  const kind = taskKind(task);
  const open = !isTerminalTaskStatus(task.status);

  const { data: patient } = usePatient(patientId);
  const { data: claimResponse } = useOrderPaStatus(
    trackingId,
    providerFhirUrl,
    true,
  );
  const { data: coverageBundle } = useCoverage(patientId);
  const primaryCoverage = (coverageBundle?.entry ?? [])
    .map((e) => e.resource)
    .find((r): r is Coverage => r?.resourceType === "Coverage");

  const isDocRequest = kind !== "tracking";
  const canSubmitDocs = open && isDocRequest;
  const { data: qrBundle } = useOrderQuestionnaireResponses(
    canSubmitDocs ? orderRef : undefined,
    canSubmitDocs ? patientId : undefined,
  );
  const newCompletedQrIds = selectNewCompletedQrs(
    qrBundle?.entry,
    task.authoredOn ?? claimResponse?.created,
  )
    .map((qr) => qr.id)
    .filter((id): id is string => !!id);

  const submittedQrRefs = refsOfType(task, "QuestionnaireResponse");
  const docRefRefs = refsOfType(task, "DocumentReference");
  const { data: submittedQrs } = useQuery({
    queryKey: ["task-sheet-submitted-qrs", providerFhirUrl, submittedQrRefs],
    queryFn: () =>
      Promise.all(
        submittedQrRefs.map((ref) =>
          fhirFetch<QuestionnaireResponse>(`${providerFhirUrl}/${ref}`).catch(
            () => null,
          ),
        ),
      ),
    enabled: submittedQrRefs.length > 0 && !!providerFhirUrl,
  });

  const launchDtrForTask = useLaunchDtrForTask();
  const handleComplete = useCallback(() => {
    const launched = launchDtrForTask(task, {
      iss: providerFhirUrl,
      patientId,
      coverageRef: primaryCoverage?.id
        ? `Coverage/${primaryCoverage.id}`
        : undefined,
    });
    if (!launched) toast.error("This request has no questionnaire to launch");
  }, [launchDtrForTask, task, providerFhirUrl, patientId, primaryCoverage?.id]);

  const submitAttachment = useSubmitAttachment();
  const completeDocTask = useCompleteDocumentationTask();
  const handleSubmit = useCallback(() => {
    if (newCompletedQrIds.length === 0) return;
    submitAttachment.mutate(
      {
        task,
        payerFhirUrl,
        providerFhirUrl,
        coverageId: primaryCoverage?.id,
        questionnaireResponseIds: newCompletedQrIds,
        final: isFinalAttachment,
      },
      {
        onSuccess: () => {
          completeDocTask.mutate({
            task,
            questionnaireResponseIds: newCompletedQrIds,
          });
          toast.success("Documentation sent to payer");
          closeTaskSheet();
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Submit failed"),
      },
    );
  }, [
    task,
    payerFhirUrl,
    providerFhirUrl,
    primaryCoverage?.id,
    newCompletedQrIds,
    isFinalAttachment,
    submitAttachment,
    completeDocTask,
    closeTaskSheet,
  ]);

  const [orderType, orderId] = orderRef?.split("/") ?? [];
  const patientName = formatPatientName(patient?.name);
  const payer = taskPayerLabel(task);

  return (
    <div className="space-y-5 p-4 text-sm">
      <div className="flex items-center gap-2">
        <TaskStatusBadge status={task.status} />
        <span className="text-muted-foreground">{taskTypeLabel(task)}</span>
      </div>

      <p className="font-medium">{taskWaitingSummary(task, claimResponse)}</p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Patient</dt>
        <dd>{patientName || patientId || "Unknown"}</dd>
        <dt className="text-muted-foreground">Order</dt>
        <dd className="font-mono text-xs">{orderRef ?? "None"}</dd>
        <dt className="text-muted-foreground">Payer</dt>
        <dd>{payer ?? "Unknown"}</dd>
        <dt className="text-muted-foreground">Requested</dt>
        <dd>{formatClinicalDate(task.authoredOn) || "Unknown"}</dd>
        <dt className="text-muted-foreground">Last updated</dt>
        <dd>{formatClinicalDate(task.meta?.lastUpdated) || "Unknown"}</dd>
        {trackingId && (
          <>
            <dt className="text-muted-foreground">Tracking ID</dt>
            <dd className="font-mono text-xs">{trackingId}</dd>
          </>
        )}
      </dl>

      {isDocRequest && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
            Requested by payer
          </h3>
          {kind === "questionnaire" ? (
            <p>{taskQuestionnaireLabel(task)}</p>
          ) : (
            <ul className="list-inside list-disc space-y-0.5">
              {taskAttachmentLabels(task).map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {claimResponse && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
            Prior authorization outcome
          </h3>
          <p className="capitalize">{claimResponse.outcome ?? "Unknown"}</p>
          {claimResponse.disposition && (
            <p className="text-muted-foreground">{claimResponse.disposition}</p>
          )}
        </section>
      )}

      {(submittedQrRefs.length > 0 || docRefRefs.length > 0) && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
            Submitted documentation
          </h3>
          <div className="space-y-1.5">
            {(submittedQrs ?? [])
              .filter((qr): qr is QuestionnaireResponse => !!qr)
              .map((qr) => (
                <SubmittedQrRow key={qr.id} qr={qr} />
              ))}
            {docRefRefs.map((ref) => (
              <p key={ref} className="font-mono text-xs">
                {ref}
              </p>
            ))}
          </div>
        </section>
      )}

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        {open && kind === "questionnaire" && (
          <Button size="sm" onClick={handleComplete}>
            <Play className="mr-1 h-3 w-3" />
            Complete questionnaire
          </Button>
        )}
        {canSubmitDocs && newCompletedQrIds.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSubmit}
            disabled={submitAttachment.isPending}
          >
            {submitAttachment.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Send className="mr-1 h-3 w-3" />
            )}
            Submit to payer
          </Button>
        )}
        {patientId && orderId && (
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/patients/$patientId/orders/$orderId/pas"
              params={{ patientId, orderId }}
              search={{ orderType, claimResponseId: trackingId }}
              onClick={closeTaskSheet}
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              Open order
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function SubmittedQrRow({ qr }: { qr: QuestionnaireResponse }) {
  const [showViewer, setShowViewer] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate">
        {formatQuestionnaireName(qr.questionnaire)}
      </span>
      <Button variant="ghost" size="sm" onClick={() => setShowViewer(true)}>
        <Eye className="mr-1 h-3 w-3" />
        View
      </Button>
      {showViewer && (
        <CompletedQrViewer qr={qr} onClose={() => setShowViewer(false)} />
      )}
    </div>
  );
}

/** Opens the Task detail sheet in the shared single-slot task sheet. */
export function useTaskDetailSheet() {
  const { openTaskSheet } = useTaskSheet();
  return useCallback(
    (task: Task, opts?: { isFinalAttachment?: boolean }) => {
      openTaskSheet({
        title: taskTypeLabel(task),
        description: task.focus?.reference,
        width: "480px",
        content: (
          <TaskDetailSheet
            task={task}
            isFinalAttachment={opts?.isFinalAttachment}
          />
        ),
      });
    },
    [openTaskSheet],
  );
}
