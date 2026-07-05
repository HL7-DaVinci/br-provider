export function serializeQuestionnaireSearch(
  questionnaire: string | string[] | null | undefined,
): string | undefined {
  if (Array.isArray(questionnaire)) {
    const canonicals = questionnaire.filter(Boolean);
    return canonicals.length > 0 ? canonicals.join(",") : undefined;
  }

  return questionnaire ?? undefined;
}

export function parseQuestionnaireSearch(
  questionnaire: string | undefined,
): string[] {
  return questionnaire?.split(",").filter(Boolean) ?? [];
}

export function serializeOrderRefs(
  orderRefs: string[] | null | undefined,
): string | undefined {
  if (!orderRefs) return undefined;
  const refs = orderRefs.filter(Boolean);
  return refs.length > 0 ? refs.join(",") : undefined;
}

export function parseOrderRefs(orderRefs: string | undefined): string[] {
  return orderRefs?.split(",").filter(Boolean) ?? [];
}

/**
 * Builds the `fhirContext` search value for a documentation Task launch.
 * Always includes the Task reference (which flips the workspace's
 * `isTaskLaunch`/`intendedUse` detection) and the Task's `focus` reference
 * (the order), so the saved QuestionnaireResponse carries the order
 * `qr-context` that completion matching requires - in addition to any other
 * refs (e.g. Coverage) already known to the caller.
 */
export function buildTaskFhirContext(
  task: { id?: string; focus?: { reference?: string } },
  additionalRefs: (string | undefined)[] = [],
): string {
  const refs = [
    ...additionalRefs,
    task.id ? `Task/${task.id}` : undefined,
    task.focus?.reference,
  ].filter((ref): ref is string => !!ref);
  return Array.from(new Set(refs)).join(",");
}
