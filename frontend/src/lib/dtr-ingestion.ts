import type {
  Bundle,
  Coding,
  ParametersParameter,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  ValueSet,
} from "fhir/r4";

/**
 * Extracts every inner package Bundle from a `$questionnaire-package`
 * response. The DTR spec wraps each Bundle in a
 * `Parameters.parameter[name=packagebundle]`, and a single response may
 * contain multiple packagebundles: one per requested questionnaire, and some
 * payers return all order-linked questionnaires regardless of which
 * canonical was asked for. A direct Bundle response is returned as a
 * single-element array.
 */
export function extractPackageBundles(data: unknown): Bundle[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;

  if (obj.resourceType === "Bundle") {
    return [obj as unknown as Bundle];
  }

  if (obj.resourceType !== "Parameters" || !Array.isArray(obj.parameter)) {
    return [];
  }

  const bundles: Bundle[] = [];
  for (const param of obj.parameter as ParametersParameter[]) {
    if (
      param.name === "packagebundle" &&
      param.resource?.resourceType === "Bundle"
    ) {
      bundles.push(param.resource as Bundle);
    }
  }
  return bundles;
}

/**
 * Selects the packagebundle whose Questionnaire entry matches `canonical`
 * (with or without the `|version` suffix). Falls back to the first bundle
 * when no match or no canonical is supplied.
 */
export function selectPackageBundle(
  bundles: Bundle[],
  canonical?: string,
): Bundle | null {
  if (bundles.length === 0) return null;
  if (!canonical || bundles.length === 1) return bundles[0];

  const targetUrl = canonical.split("|")[0];
  const match = bundles.find((b) =>
    b.entry?.some((e) => {
      const r = e.resource;
      if (r?.resourceType !== "Questionnaire") return false;
      const url = (r as Questionnaire).url;
      return url === canonical || url === targetUrl;
    }),
  );
  return match ?? bundles[0];
}

/**
 * Inlines answer options for items whose answerValueSet matches an expanded
 * ValueSet carried in the package bundle. LForms only resolves answerValueSet
 * URLs against a terminology server, so without this the payer-supplied
 * expansions would be ignored and choice items would fail to render options.
 */
export function inlineBundleValueSets(
  questionnaire: Questionnaire,
  bundle: Bundle,
): Questionnaire {
  const valueSets = new Map<string, ValueSet>();
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType !== "ValueSet") continue;
    const vs = resource as ValueSet;
    if (vs.url && vs.expansion?.contains?.length) {
      valueSets.set(vs.url, vs);
    }
  }
  if (valueSets.size === 0) return questionnaire;

  const result = structuredClone(questionnaire);
  const walk = (items?: QuestionnaireItem[]) => {
    for (const item of items ?? []) {
      const url = item.answerValueSet?.split("|")[0];
      const vs = url ? valueSets.get(url) : undefined;
      if (vs && !item.answerOption?.length) {
        item.answerOption = (vs.expansion?.contains ?? []).map((c) => ({
          valueCoding: { system: c.system, code: c.code, display: c.display },
        }));
        delete item.answerValueSet;
      }
      walk(item.item);
    }
  };
  walk(result.item);
  return result;
}

/**
 * Aligns prepopulated answers with the questionnaire's answer options.
 * $populate CQL evaluation yields bare code strings for choice items, and
 * LForms silently drops answers that do not match an option coding. Strings
 * (and system-less codings) are matched to an option by code or display,
 * case-insensitively, and replaced with the option's full coding. Answer
 * extensions (e.g. information-origin) are preserved.
 */
export function alignChoiceAnswers(
  response: QuestionnaireResponse,
  questionnaire: Questionnaire,
): QuestionnaireResponse {
  const optionsByLinkId = new Map<string, Coding[]>();
  const collect = (items?: QuestionnaireItem[]) => {
    for (const item of items ?? []) {
      const codings = (item.answerOption ?? [])
        .map((option) => option.valueCoding)
        .filter((c): c is Coding => Boolean(c?.code));
      if (codings.length > 0) {
        optionsByLinkId.set(item.linkId, codings);
      }
      collect(item.item);
    }
  };
  collect(questionnaire.item);
  if (optionsByLinkId.size === 0) return response;

  const result = structuredClone(response);
  const walk = (items?: QuestionnaireResponseItem[]) => {
    for (const item of items ?? []) {
      const codings = optionsByLinkId.get(item.linkId);
      for (const answer of item.answer ?? []) {
        if (codings) {
          const raw =
            answer.valueString ??
            (answer.valueCoding && !answer.valueCoding.system
              ? answer.valueCoding.code
              : undefined);
          const match =
            raw === undefined
              ? undefined
              : codings.find(
                  (c) =>
                    c.code?.toLowerCase() === raw.toLowerCase() ||
                    c.display?.toLowerCase() === raw.toLowerCase(),
                );
          if (match) {
            delete answer.valueString;
            answer.valueCoding = { ...match };
          }
        }
        walk(answer.item);
      }
      walk(item.item);
    }
  };
  walk(result.item);
  return result;
}
