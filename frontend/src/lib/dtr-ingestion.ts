import type { Bundle, ParametersParameter, Questionnaire } from "fhir/r4";

/**
 * Extracts the inner package Bundle from a `$questionnaire-package` response.
 * The DTR spec wraps each Bundle in a `Parameters.parameter[name=packagebundle]`
 * and a single response may contain multiple packagebundles (one per requested
 * questionnaire — and some payers return all order-linked questionnaires
 * regardless of which canonical was asked for). When `canonical` is provided,
 * returns the bundle whose Questionnaire entry matches it (with or without
 * the `|version` suffix). Falls back to the first packagebundle when no match
 * or no canonical is supplied. Direct Bundle responses pass through.
 */
export function extractPackageBundle(
  data: unknown,
  canonical?: string,
): Bundle | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  if (obj.resourceType === "Bundle") {
    return obj as unknown as Bundle;
  }

  if (obj.resourceType !== "Parameters" || !Array.isArray(obj.parameter)) {
    return null;
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
