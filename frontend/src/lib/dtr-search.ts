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
