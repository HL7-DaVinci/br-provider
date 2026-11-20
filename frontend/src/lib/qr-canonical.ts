import type { Questionnaire, QuestionnaireResponse } from "fhir/r4";

/** Drops a `|version` suffix from a canonical URL. */
export function stripCanonicalVersion(canonical: string): string {
  const pipeIdx = canonical.indexOf("|");
  return pipeIdx === -1 ? canonical : canonical.substring(0, pipeIdx);
}

/**
 * The canonical of the Questionnaire a QR answers. An adaptive QR points
 * `questionnaire` at a contained Questionnaire (`#id`), so the canonical
 * comes from that resource's `derivedFrom`, falling back to its `url`.
 * Returns undefined when the contained reference cannot be resolved.
 */
export function qrCanonical(
  qr: Pick<QuestionnaireResponse, "questionnaire" | "contained">,
): string | undefined {
  const ref = qr.questionnaire;
  if (!ref) return undefined;
  if (!ref.startsWith("#")) return ref;
  const localId = ref.slice(1);
  const contained = (qr.contained ?? []).find(
    (r): r is Questionnaire =>
      r.resourceType === "Questionnaire" && r.id === localId,
  );
  return contained?.derivedFrom?.[0] ?? contained?.url;
}
