import type { Task } from "fhir/r4";
import { useCallback } from "react";
import {
  type DtrTaskContext,
  DtrWorkspace,
} from "@/components/dtr/dtr-workspace";
import { useTaskSheet } from "@/components/task-sheet";
import { extractTaskQuestionnaireContexts } from "@/hooks/use-pas";
import { buildTaskFhirContext } from "@/lib/dtr-search";

export function useDtrTaskSheet() {
  const { openTaskSheet, closeTaskSheet } = useTaskSheet();

  return useCallback(
    (context: DtrTaskContext) => {
      openTaskSheet({
        title: "Documentation",
        description: context.orderRef ?? context.fhirContext,
        width: "94vw",
        content: <DtrWorkspace context={context} onClose={closeTaskSheet} />,
      });
    },
    [openTaskSheet, closeTaskSheet],
  );
}

/**
 * Launches the DTR workspace for a documentation-request Task. Returns false
 * when the Task carries no questionnaire-context inputs to launch from.
 */
export function useLaunchDtrForTask() {
  const openDtrTask = useDtrTaskSheet();

  return useCallback(
    (
      task: Task,
      opts: { iss: string; patientId?: string; coverageRef?: string },
    ): boolean => {
      const contexts = extractTaskQuestionnaireContexts([task]);
      if (contexts.length === 0) return false;
      openDtrTask({
        iss: opts.iss,
        patientId: opts.patientId,
        // Every questionnaire-context input is queued, not just the first,
        // so the payer resolves and returns all of this Task's questionnaires.
        coverageAssertionId: contexts.join(","),
        fhirContext: buildTaskFhirContext(task, [opts.coverageRef]),
      });
      return true;
    },
    [openDtrTask],
  );
}
