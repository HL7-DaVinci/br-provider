import type { ClaimResponse, Task } from "fhir/r4";
import { formatQuestionnaireName } from "./clinical-formatters";
import { isPendedClaimResponse } from "./pas-pend-status";

const TASK_CODE_SYSTEM =
  "http://hl7.org/fhir/us/davinci-pas/CodeSystem/PASTempCodes";
const TASK_CODE_QUESTIONNAIRE_REQUEST = "attachment-request-questionnaire";
const TASK_CODE_ATTACHMENT_REQUEST = "attachment-request-code";
const TASK_INPUT_QUESTIONNAIRE_CONTEXT = "questionnaire-context";
const TASK_INPUT_ATTACHMENTS_NEEDED = "attachments-needed";

export const TERMINAL_TASK_STATUSES = [
  "completed",
  "cancelled",
  "failed",
  "rejected",
  "entered-in-error",
];

export function isTerminalTaskStatus(status: string | undefined): boolean {
  return TERMINAL_TASK_STATUSES.includes(status ?? "");
}

export function partitionTasks(tasks: Task[]): {
  active: Task[];
  closed: Task[];
} {
  const active: Task[] = [];
  const closed: Task[] = [];
  for (const task of tasks) {
    (isTerminalTaskStatus(task.status) ? closed : active).push(task);
  }
  return { active, closed };
}

export type TaskKind = "questionnaire" | "attachment" | "tracking";

export function taskKind(task: Task): TaskKind {
  const code = task.code?.coding?.find(
    (c) => c.system === TASK_CODE_SYSTEM,
  )?.code;
  if (code === TASK_CODE_QUESTIONNAIRE_REQUEST) return "questionnaire";
  if (code === TASK_CODE_ATTACHMENT_REQUEST) return "attachment";
  return "tracking";
}

const TASK_KIND_LABELS: Record<TaskKind, string> = {
  questionnaire: "Questionnaire requested",
  attachment: "Documents requested",
  tracking: "PA status",
};

export function taskTypeLabel(task: Task): string {
  return TASK_KIND_LABELS[taskKind(task)];
}

export function taskPayerLabel(task: Task): string | undefined {
  return task.requester?.display ?? task.requester?.identifier?.value;
}

function inputValues(task: Task, inputCode: string) {
  return (task.input ?? []).filter((input) =>
    input.type?.coding?.some(
      (c) => c.system === TASK_CODE_SYSTEM && c.code === inputCode,
    ),
  );
}

/** Display name for a questionnaire-request Task, matching the pattern used on the patient Documentation page. */
export function taskQuestionnaireLabel(task: Task): string {
  const firstContext = inputValues(task, TASK_INPUT_QUESTIONNAIRE_CONTEXT).find(
    (input) => input.valueString,
  )?.valueString;
  return (
    task.description ||
    (firstContext ? formatQuestionnaireName(firstContext) : "") ||
    "Documentation Request"
  );
}

/** Display labels for the attachment codes an attachment-request Task asks for. */
export function taskAttachmentLabels(task: Task): string[] {
  return inputValues(task, TASK_INPUT_ATTACHMENTS_NEEDED)
    .flatMap((input) => input.valueCodeableConcept?.coding ?? [])
    .map((coding) => coding.display ?? coding.code)
    .filter((label): label is string => !!label);
}

/**
 * Worklist visibility: documentation-request Tasks (attachment-request coded)
 * always appear; uncoded PA-tracking Tasks appear only while open, so a
 * pended PA shows as "waiting on payer" but a PA decided at submission never
 * surfaces. Tracking Tasks remain persisted either way as the
 * order-to-ClaimResponse join record.
 */
export function isWorklistTask(task: Task): boolean {
  return taskKind(task) !== "tracking" || !isTerminalTaskStatus(task.status);
}

/**
 * One-line summary of what a Task is waiting on or what it finished.
 * The optional ClaimResponse refines tracking-task wording (pend detection,
 * disposition); without it the Task status alone is used, which is reliable
 * because the builder and the PAS resolution service both encode the
 * ClaimResponse outcome into Task.status.
 */
export function taskWaitingSummary(
  task: Task,
  claimResponse?: ClaimResponse | null,
): string {
  const kind = taskKind(task);
  const status = task.status ?? "";

  if (isTerminalTaskStatus(status)) {
    if (status === "completed") {
      if (kind === "tracking") {
        return claimResponse?.disposition
          ? `Prior authorization approved: ${claimResponse.disposition}`
          : "Prior authorization approved";
      }
      return "Documentation submitted to payer";
    }
    if (status === "failed") {
      return (
        task.statusReason?.text ??
        (kind === "tracking" ? "Prior authorization denied" : "Request failed")
      );
    }
    return `Request ${status}`;
  }

  if (kind === "questionnaire") {
    return `Waiting on you: complete ${taskQuestionnaireLabel(task)}`;
  }
  if (kind === "attachment") {
    const labels = taskAttachmentLabels(task);
    return labels.length > 0
      ? `Waiting on you: attach ${labels.join(", ")}`
      : "Waiting on you: attach requested documents";
  }
  if (claimResponse && isPendedClaimResponse(claimResponse)) {
    return "Waiting on payer decision";
  }
  return status === "in-progress"
    ? "Waiting on payer decision"
    : "Waiting on payer response";
}
