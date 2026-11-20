import type {
  Bundle,
  Coding,
  FhirResource,
  ParametersParameter,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  Resource,
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
  const bundleValueSets = (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource) => resource?.resourceType === "ValueSet") as ValueSet[];
  return inlineValueSets(
    questionnaire,
    bundleValueSets,
    questionnaire.contained ?? [],
  );
}

/**
 * Inlines answer options from expanded ValueSets. `shared` ValueSets match an
 * answerValueSet canonical by url. `local` resources are contained alongside
 * the Questionnaire: in Questionnaire.contained, or as siblings of a contained
 * Questionnaire in an adaptive QuestionnaireResponse. They match by "#<id>"
 * and also by url, since payers use either form to reference them.
 */
export function inlineValueSets(
  questionnaire: Questionnaire,
  shared: ValueSet[],
  local: Resource[],
): Questionnaire {
  const valueSets = new Map<string, ValueSet>();
  const register = (vs: ValueSet, key: string | undefined) => {
    if (key && vs.expansion?.contains?.length) valueSets.set(key, vs);
  };
  for (const vs of shared) {
    register(vs, vs.url);
  }
  for (const resource of local) {
    if (resource.resourceType === "ValueSet") {
      const vs = resource as ValueSet;
      register(vs, vs.id ? `#${vs.id}` : undefined);
      register(vs, vs.url);
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
 * Narrows populated dateTime answers to dates on `date` items. CQL evaluates
 * FHIR dateTime elements (e.g. Encounter.period.start) to dateTime values, and
 * LForms drops a valueDateTime on a date item instead of truncating it.
 */
export function coerceDateAnswers(
  response: QuestionnaireResponse,
  questionnaire: Questionnaire,
): QuestionnaireResponse {
  const dateLinkIds = new Set<string>();
  const collect = (items?: QuestionnaireItem[]) => {
    for (const item of items ?? []) {
      if (item.type === "date") dateLinkIds.add(item.linkId);
      collect(item.item);
    }
  };
  collect(questionnaire.item);
  if (dateLinkIds.size === 0) return response;

  const result = structuredClone(response);
  const walk = (items?: QuestionnaireResponseItem[]) => {
    for (const item of items ?? []) {
      for (const answer of item.answer ?? []) {
        if (dateLinkIds.has(item.linkId) && answer.valueDateTime) {
          answer.valueDate = answer.valueDateTime.slice(0, 10);
          delete answer.valueDateTime;
        }
        walk(answer.item);
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

const POPULATE_SUPPORT_TYPES = new Set(["Library", "ValueSet", "CodeSystem"]);

/**
 * Returns a copy of a package bundle with additional Libraries, ValueSets and
 * CodeSystems appended. The adaptive loop uses it to populate a Questionnaire
 * revision from $next-question, whose CQL may live in Libraries the payer only
 * ships contained in that response rather than in the original package.
 * An added resource replaces a bundle entry of the same type with the same
 * url, or with the same id when either lacks a url.
 */
export function withPackageResources(
  bundle: Bundle,
  resources: Resource[],
): Bundle {
  const entries = [...(bundle.entry ?? [])];
  for (const resource of resources) {
    if (!POPULATE_SUPPORT_TYPES.has(resource.resourceType)) continue;
    const url = (resource as { url?: string }).url;
    const idx = entries.findIndex((e) => {
      const r = e.resource;
      if (r?.resourceType !== resource.resourceType) return false;
      const rUrl = (r as { url?: string }).url;
      return url && rUrl ? rUrl === url : Boolean(r.id) && r.id === resource.id;
    });
    const entry = { resource: resource as FhirResource };
    if (idx >= 0) entries[idx] = entry;
    else entries.push(entry);
  }
  return { ...bundle, entry: entries };
}
