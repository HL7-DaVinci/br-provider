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
