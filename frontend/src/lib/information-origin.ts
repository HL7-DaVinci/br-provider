import type {
  Extension,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseItemAnswer,
} from "fhir/r4";

const INFORMATION_ORIGIN_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/information-origin";

export type OriginSource =
  | "auto-server"
  | "auto-client"
  | "manual"
  | "override";

export interface AnswerSnapshot {
  serializedValue: string;
  source: OriginSource;
}

// -- Extension helpers --

function makeOriginExtension(source: OriginSource): Extension {
  return {
    url: INFORMATION_ORIGIN_URL,
    extension: [{ url: "source", valueCode: source }],
  };
}

function hasOriginExtension(answer: QuestionnaireResponseItemAnswer): boolean {
  return (
    answer.extension?.some((ext) => ext.url === INFORMATION_ORIGIN_URL) ?? false
  );
}

function getOriginSource(
  answer: QuestionnaireResponseItemAnswer,
): OriginSource | null {
  const ext = answer.extension?.find((e) => e.url === INFORMATION_ORIGIN_URL);
  if (!ext?.extension) return null;
  const sourceExt = ext.extension.find((e) => e.url === "source");
  return (sourceExt?.valueCode as OriginSource) ?? null;
}

// -- Value extraction for comparison --

/** Extracts the value[x] from an answer for serialized comparison. */
function extractAnswerValue(
  answer: QuestionnaireResponseItemAnswer,
): string | null {
  const valueKeys = [
    "valueBoolean",
    "valueDecimal",
    "valueInteger",
    "valueDate",
    "valueDateTime",
    "valueTime",
    "valueString",
    "valueUri",
    "valueAttachment",
    "valueCoding",
    "valueQuantity",
    "valueReference",
  ] as const;

  for (const key of valueKeys) {
    const val = (answer as Record<string, unknown>)[key];
    if (val !== undefined && val !== null) {
      return canonicalStringify(val);
    }
  }
  return null;
}

/** Canonical JSON stringify with sorted keys for stable comparison. */
function canonicalStringify(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (typeof val !== "object") return JSON.stringify(val);
  if (Array.isArray(val)) {
    return `[${val.map(canonicalStringify).join(",")}]`;
  }
  const sorted = Object.keys(val as Record<string, unknown>)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonicalStringify((val as Record<string, unknown>)[k])}`,
    );
  return `{${sorted.join(",")}}`;
}

// -- Recursive item walkers --

function walkAnswers(
  items: QuestionnaireResponseItem[] | undefined,
  fn: (answer: QuestionnaireResponseItemAnswer) => void,
): void {
  if (!items) return;
  for (const item of items) {
    if (item.answer) {
      for (const answer of item.answer) {
        fn(answer);
        walkAnswers(answer.item, fn);
      }
    }
    walkAnswers(item.item, fn);
  }
}

function buildItemMap(
  items: QuestionnaireResponseItem[] | undefined,
): Map<string, QuestionnaireResponseItem> {
  const map = new Map<string, QuestionnaireResponseItem>();
  if (!items) return map;
  for (const item of items) {
    map.set(item.linkId, item);
  }
  return map;
}

// -- Public API --

/**
 * Stamps all answers in a QR with the given information-origin source.
 * Answers that already have the extension are left untouched.
 * Returns a deep clone.
 */
export function stampOrigins(
  qr: QuestionnaireResponse,
  source: OriginSource,
): QuestionnaireResponse {
  const clone = structuredClone(qr);
  walkAnswers(clone.item, (answer) => {
    if (!hasOriginExtension(answer) && extractAnswerValue(answer) !== null) {
      if (!answer.extension) answer.extension = [];
      answer.extension.push(makeOriginExtension(source));
    }
  });
  return clone;
}

/**
 * Merges two QuestionnaireResponses by linkId.
 * Provider answers override payer answers for the same linkId.
 * Items only in one QR are preserved.
 */
export function mergeQuestionnaireResponses(
  payerQr: QuestionnaireResponse,
  providerQr: QuestionnaireResponse,
): QuestionnaireResponse {
  const merged = structuredClone(payerQr);
  merged.item = mergeItems(merged.item ?? [], providerQr.item ?? []);
  return merged;
}

function mergeItems(
  payerItems: QuestionnaireResponseItem[],
  providerItems: QuestionnaireResponseItem[],
): QuestionnaireResponseItem[] {
  const providerMap = buildItemMap(providerItems);
  const seen = new Set<string>();
  const result: QuestionnaireResponseItem[] = [];

  for (const payerItem of payerItems) {
    seen.add(payerItem.linkId);
    const providerItem = providerMap.get(payerItem.linkId);

    if (providerItem) {
      const providerHasAnswer =
        providerItem.answer?.some((a) => extractAnswerValue(a) !== null) ??
        false;

      const merged: QuestionnaireResponseItem = {
        ...payerItem,
        answer: providerHasAnswer ? providerItem.answer : payerItem.answer,
        item: mergeItems(payerItem.item ?? [], providerItem.item ?? []),
      };
      result.push(merged);
    } else {
      result.push(payerItem);
    }
  }

  for (const providerItem of providerItems) {
    if (!seen.has(providerItem.linkId)) {
      result.push(providerItem);
    }
  }

  return result;
}

/**
 * Builds a snapshot index of all answer values and their origin sources,
 * keyed by linkId. Used for diffing against the LHC-Forms exported QR.
 */
export function buildOriginIndex(
  qr: QuestionnaireResponse,
): Map<string, AnswerSnapshot[]> {
  const index = new Map<string, AnswerSnapshot[]>();

  function walkItems(items: QuestionnaireResponseItem[] | undefined): void {
    if (!items) return;
    for (const item of items) {
      if (item.answer) {
        const snapshots: AnswerSnapshot[] = [];
        for (const answer of item.answer) {
          const serialized = extractAnswerValue(answer);
          if (serialized !== null) {
            const source = getOriginSource(answer) ?? "auto-server";
            snapshots.push({ serializedValue: serialized, source });
          }
          walkItems(answer.item);
        }
        if (snapshots.length > 0) {
          index.set(item.linkId, snapshots);
        }
      }
      walkItems(item.item);
    }
  }

  walkItems(qr.item);
  return index;
}

/**
 * Applies information-origin tracking to an LHC-Forms-exported QR
 * by comparing each answer against the pre-population snapshot.
 *
 * - Unchanged auto value: restores original origin
 * - Changed auto value: stamps "override"
 * - New value (no prior auto): stamps "manual"
 */
export function applyOriginTracking(
  exportedQr: QuestionnaireResponse,
  originIndex: Map<string, AnswerSnapshot[]>,
): QuestionnaireResponse {
  const result = structuredClone(exportedQr);

  function walkItems(items: QuestionnaireResponseItem[] | undefined): void {
    if (!items) return;
    for (const item of items) {
      if (item.answer) {
        const snapshots = originIndex.get(item.linkId);

        for (let i = 0; i < item.answer.length; i++) {
          const answer = item.answer[i];
          const currentValue = extractAnswerValue(answer);
          if (currentValue === null) continue;

          const snapshot = snapshots?.[i];

          // Remove any existing origin extensions (LHC-Forms may not preserve them)
          if (answer.extension) {
            answer.extension = answer.extension.filter(
              (e) => e.url !== INFORMATION_ORIGIN_URL,
            );
            if (answer.extension.length === 0) delete answer.extension;
          }

          if (!snapshot) {
            // No pre-populated value for this answer position
            if (!answer.extension) answer.extension = [];
            answer.extension.push(makeOriginExtension("manual"));
          } else if (currentValue === snapshot.serializedValue) {
            // Value unchanged from pre-population
            if (!answer.extension) answer.extension = [];
            answer.extension.push(makeOriginExtension(snapshot.source));
          } else {
            // Value was modified by the user
            if (!answer.extension) answer.extension = [];
            answer.extension.push(makeOriginExtension("override"));
          }

          walkItems(answer.item);
        }
      }
      walkItems(item.item);
    }
  }

  walkItems(result.item);
  return result;
}
