import { useCallback } from "react";
import {
  type DtrTaskContext,
  DtrWorkspace,
} from "@/components/dtr/dtr-workspace";
import { useTaskSheet } from "@/components/task-sheet";

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
