import type { DomainResource, Extension, QuestionnaireResponse } from "fhir/r4";
import { fhirProxyUrl } from "@/lib/api";
import {
  COVERAGE_INFO_EXT_URL,
  coverageInfoPrimaryKeyEquals,
  parseExtensionFields,
} from "@/lib/coverage-extensions";

/**
 * Applies a list of CoverageInformation extension repetitions from a
 * QuestionnaireResponse to an order resource, per DTR IG:
 * each QR CI either replaces an order CI with the same (coverage,
 * coverage-assertion-id) primary key, or is appended as a new repetition
 * when no match exists. Unrelated extensions on the order are untouched.
 * Returns a new resource with the updated extension array; does not mutate
 * the input.
 */
export function applyQrCisToOrder<R extends DomainResource>(
  order: R,
  qrCis: Extension[],
): R {
  const orderExts = order.extension ?? [];
  const consumed = new Set<number>(); // indices of QR CIs that replaced order CIs
  const next: Extension[] = orderExts.map((ext) => {
    if (ext.url !== COVERAGE_INFO_EXT_URL || !ext.extension) return ext;
    const orderCi = parseExtensionFields(ext.extension);
    for (let qi = 0; qi < qrCis.length; qi++) {
      if (consumed.has(qi)) continue;
      const qrExt = qrCis[qi];
      if (!qrExt.extension) continue;
      const qrCi = parseExtensionFields(qrExt.extension);
      if (coverageInfoPrimaryKeyEquals(orderCi, qrCi)) {
        consumed.add(qi);
        return qrExt;
      }
    }
    return ext;
  });

  for (let qi = 0; qi < qrCis.length; qi++) {
    if (!consumed.has(qi)) next.push(qrCis[qi]);
  }

  return { ...order, extension: next };
}

export interface CoveragePropagationParams {
  qr: QuestionnaireResponse;
  orderRefs: string[];
  providerFhirUrl: string;
}

/**
 * Propagates the CoverageInformation extension repetitions from a saved
 * QuestionnaireResponse onto each order in `orderRefs`, per DTR IG:
 * order CIs with the same (coverage, coverage-assertion-id)
 * primary key as a QR CI are replaced; QR CIs with no matching order CI
 * are appended as new repetitions. Each order is fetched and PUT
 * individually through the FHIR proxy.
 *
 * No-ops if the QR has no CoverageInformation extensions, or if
 * `orderRefs` or `providerFhirUrl` are empty.
 */
export async function propagateCoverageInfo({
  qr,
  orderRefs,
  providerFhirUrl,
}: CoveragePropagationParams): Promise<void> {
  if (orderRefs.length === 0 || !providerFhirUrl) return;

  const qrCis = (qr.extension ?? []).filter(
    (ext) => ext.url === COVERAGE_INFO_EXT_URL && !!ext.extension,
  );
  if (qrCis.length === 0) return;

  const uniqueRefs = Array.from(new Set(orderRefs));
  await Promise.all(
    uniqueRefs.map((orderRef) =>
      writeOrder({ orderRef, providerFhirUrl, qrCis }),
    ),
  );
}

async function writeOrder(params: {
  orderRef: string;
  providerFhirUrl: string;
  qrCis: Extension[];
}): Promise<void> {
  const orderUrl = `${params.providerFhirUrl}/${params.orderRef}`;
  const orderResponse = await fetch(fhirProxyUrl(orderUrl), {
    credentials: "same-origin",
  });
  if (!orderResponse.ok) return;
  const order = (await orderResponse.json()) as DomainResource;

  const updated = applyQrCisToOrder(order, params.qrCis);

  await fetch(fhirProxyUrl(orderUrl), {
    method: "PUT",
    headers: { "Content-Type": "application/fhir+json" },
    credentials: "same-origin",
    body: JSON.stringify(updated),
  });
}
