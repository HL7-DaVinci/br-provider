import type { Bundle, FhirResource } from "fhir/r4";

/**
 * Fetches a FHIR query (relative like "Patient/123" or
 * "PractitionerRole?_id=a,b", or absolute) and returns the parsed JSON, or
 * undefined on any failure.
 */
export type PrefetchFetcher = (query: string) => Promise<unknown | undefined>;

/**
 * Resolves CDS discovery prefetch templates in order. Supports the plain
 * {{context.*}} tokens plus the CRD additional prefetch capabilities subset
 * used by the published CRD services: {{%key.<path>.resolve().ofType(T).id}}
 * with `|` alternates, where %key is an earlier prefetch result. Every
 * template key is present in the result; a key whose template cannot be
 * satisfied carries null, which CDS Hooks defines as attempted-but-empty.
 * When baseUrl is given, search Bundle entry fullUrls are rewritten onto it
 * so the prefetch is self-consistent with the advertised fhirServer.
 * Templates outside this subset are skipped with a console warning.
 */
export async function resolvePrefetchTemplates(
  templates: Record<string, string>,
  context: Record<string, unknown>,
  fetchJson: PrefetchFetcher,
  baseUrl?: string,
): Promise<Record<string, unknown>> {
  const sent: Record<string, unknown> = {};
  const resolved: Record<string, unknown> = {};
  const pool = new Map<string, FhirResource>();

  for (const [key, template] of Object.entries(templates)) {
    const query = await instantiateTemplate(
      template,
      context,
      resolved,
      pool,
      fetchJson,
    );
    if (!query) {
      sent[key] = null;
      continue;
    }
    const data = await fetchJson(query);
    if (data === undefined || data === null) {
      sent[key] = null;
      continue;
    }
    if (baseUrl) rebaseBundleFullUrls(data, baseUrl);
    sent[key] = data;
    resolved[key] = data;
    indexIntoPool(data, pool);
  }
  return sent;
}

function rebaseBundleFullUrls(data: unknown, baseUrl: string): void {
  const bundle = data as Bundle;
  if (bundle?.resourceType !== "Bundle") return;
  const base = baseUrl.replace(/\/$/, "");
  for (const entry of bundle.entry ?? []) {
    const { resourceType, id } = entry.resource ?? {};
    if (resourceType && id && entry.fullUrl) {
      entry.fullUrl = `${base}/${resourceType}/${id}`;
    }
  }
}

const TOKEN_PATTERN = /\{\{([^{}]+)\}\}/g;

async function instantiateTemplate(
  template: string,
  context: Record<string, unknown>,
  resolved: Record<string, unknown>,
  pool: Map<string, FhirResource>,
  fetchJson: PrefetchFetcher,
): Promise<string | null> {
  let failed = false;
  const replacements: { token: string; value: string }[] = [];
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const expression = match[1].trim();
    let value: string | undefined;
    if (expression.startsWith("context.")) {
      const raw = context[expression.slice("context.".length)];
      if (typeof raw === "string" && raw) value = raw;
    } else if (expression.startsWith("%")) {
      const ids = await evaluateDependentToken(
        expression,
        resolved,
        pool,
        fetchJson,
      );
      if (ids.length > 0) value = ids.join(",");
    } else {
      console.warn(`[cds-prefetch] unsupported template token: ${expression}`);
    }
    if (value === undefined) {
      failed = true;
      break;
    }
    replacements.push({ token: match[0], value });
  }
  if (failed) return null;
  let query = template;
  for (const { token, value } of replacements) {
    query = query.replaceAll(token, value);
  }
  return query;
}

async function evaluateDependentToken(
  expression: string,
  resolved: Record<string, unknown>,
  pool: Map<string, FhirResource>,
  fetchJson: PrefetchFetcher,
): Promise<string[]> {
  for (const alternative of expression.split("|")) {
    const values = await evaluateAlternative(
      alternative.trim(),
      resolved,
      pool,
      fetchJson,
    );
    if (values.length > 0) return values;
  }
  return [];
}

async function evaluateAlternative(
  alternative: string,
  resolved: Record<string, unknown>,
  pool: Map<string, FhirResource>,
  fetchJson: PrefetchFetcher,
): Promise<string[]> {
  if (!alternative.startsWith("%")) return [];
  const [key, ...segments] = alternative.slice(1).split(".");
  let current: unknown[] = resolved[key] === undefined ? [] : [resolved[key]];

  for (const segment of segments) {
    if (current.length === 0) return [];
    if (segment === "resolve()") {
      current = await resolveReferences(current, pool, fetchJson);
    } else if (segment.startsWith("ofType(") && segment.endsWith(")")) {
      const type = segment.slice("ofType(".length, -1);
      current = current.filter(
        (value) => (value as { resourceType?: string })?.resourceType === type,
      );
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
      current = current.flatMap((value) => {
        const next = (value as Record<string, unknown>)?.[segment];
        if (next === undefined || next === null) return [];
        return Array.isArray(next) ? next : [next];
      });
    } else {
      console.warn(`[cds-prefetch] unsupported path segment: ${segment}`);
      return [];
    }
  }
  const unique = new Set(
    current.filter((value): value is string => typeof value === "string"),
  );
  return [...unique];
}

async function resolveReferences(
  values: unknown[],
  pool: Map<string, FhirResource>,
  fetchJson: PrefetchFetcher,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const value of values) {
    const reference = (value as { reference?: string })?.reference;
    if (!reference || reference.startsWith("#")) continue;
    const cached = pool.get(reference);
    if (cached) {
      out.push(cached);
      continue;
    }
    const fetched = await fetchJson(reference);
    const resource = fetched as FhirResource | undefined;
    if (resource?.resourceType) {
      pool.set(reference, resource);
      indexIntoPool(resource, pool);
      out.push(resource);
    }
  }
  return out;
}

function indexIntoPool(data: unknown, pool: Map<string, FhirResource>): void {
  const resource = data as FhirResource | undefined;
  if (!resource?.resourceType) return;
  if (resource.resourceType === "Bundle") {
    for (const entry of (resource as Bundle).entry ?? []) {
      indexIntoPool(entry.resource, pool);
    }
    return;
  }
  if (resource.id) {
    pool.set(`${resource.resourceType}/${resource.id}`, resource);
  }
}
