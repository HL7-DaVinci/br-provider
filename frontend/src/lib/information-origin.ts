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

function makeOriginExtension(
  source: OriginSource,
  authorRef?: string,
): Extension {
  const subExts: Extension[] = [{ url: "source", valueCode: source }];
  if (authorRef && (source === "manual" || source === "override")) {
    subExts.push({
      url: "author",
      valueReference: { reference: authorRef },
    });
  }
  return { url: INFORMATION_ORIGIN_URL, extension: subExts };
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
  options: { authorRef?: string } = {},
): QuestionnaireResponse {
  const result = structuredClone(exportedQr);
  const authorRef = options.authorRef;

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

          // Strip any LHC-Forms-emitted origin extension before re-stamping.
          if (answer.extension) {
            answer.extension = answer.extension.filter(
              (e) => e.url !== INFORMATION_ORIGIN_URL,
            );
            if (answer.extension.length === 0) delete answer.extension;
          }

          let source: OriginSource;
          if (!snapshot) {
            source = "manual";
          } else if (currentValue === snapshot.serializedValue) {
            source = snapshot.source;
          } else {
            source = "override";
          }
          if (!answer.extension) answer.extension = [];
          answer.extension.push(makeOriginExtension(source, authorRef));

          walkItems(answer.item);
        }
      }
      walkItems(item.item);
    }
  }

  walkItems(result.item);
  return result;
}

/**
 * Merges a freshly-populated candidate QuestionnaireResponse into an existing one
 * per the DTR resumption rules:
 *   manual answers are never replaced; they upshift to override when CQL
 *   asserts a value at the same position;
 *   override answers are never changed;
 *   auto-server / auto-client answers are replaced by candidate values where
 *   present (stamped auto-client) and kept where the candidate is empty.
 *
 * Items repeated at the same nesting level pair by occurrence index. Multi-answer
 * arrays reconcile slot-by-slot. Recurses into both item.item and answer.item.
 */
export function applyPopulateResult(
  existing: QuestionnaireResponse,
  candidate: QuestionnaireResponse,
): QuestionnaireResponse {
  const merged = structuredClone(existing);
  merged.item = mergeItemsByOrigin(merged.item ?? [], candidate.item ?? []);
  return merged;
}

function mergeItemsByOrigin(
  existingItems: QuestionnaireResponseItem[],
  candidateItems: QuestionnaireResponseItem[],
): QuestionnaireResponseItem[] {
  const candidatesByLinkId = new Map<string, QuestionnaireResponseItem[]>();
  for (const c of candidateItems) {
    const arr = candidatesByLinkId.get(c.linkId) ?? [];
    arr.push(c);
    candidatesByLinkId.set(c.linkId, arr);
  }
  const consumed = new Map<string, number>();
  const out: QuestionnaireResponseItem[] = [];

  for (const existing of existingItems) {
    const idx = consumed.get(existing.linkId) ?? 0;
    const cand = candidatesByLinkId.get(existing.linkId)?.[idx];
    consumed.set(existing.linkId, idx + 1);
    out.push(reconcileItem(existing, cand));
  }
  for (const [linkId, list] of candidatesByLinkId) {
    const used = consumed.get(linkId) ?? 0;
    for (let i = used; i < list.length; i++) {
      out.push(stampNewItem(list[i]));
    }
  }
  return out;
}

function reconcileItem(
  existing: QuestionnaireResponseItem,
  candidate: QuestionnaireResponseItem | undefined,
): QuestionnaireResponseItem {
  const out: QuestionnaireResponseItem = { ...existing };
  if (existing.item || candidate?.item) {
    out.item = mergeItemsByOrigin(existing.item ?? [], candidate?.item ?? []);
  }
  out.answer = reconcileAnswers(existing.answer, candidate?.answer);
  return out;
}

function reconcileAnswers(
  existingAnswers: QuestionnaireResponseItemAnswer[] | undefined,
  candidateAnswers: QuestionnaireResponseItemAnswer[] | undefined,
): QuestionnaireResponseItemAnswer[] | undefined {
  const existing = existingAnswers ?? [];
  const candidate = candidateAnswers ?? [];
  if (existing.length === 0 && candidate.length === 0) return undefined;

  const len = Math.max(existing.length, candidate.length);
  const out: QuestionnaireResponseItemAnswer[] = [];
  for (let i = 0; i < len; i++) {
    const e = existing[i];
    const c = candidate[i];
    const candidateHasValue = c !== undefined && extractAnswerValue(c) !== null;

    if (e === undefined) {
      if (c !== undefined) out.push(withOriginSource(c, "auto-client"));
      continue;
    }

    const source = getOriginSource(e);
    if (source === "override") {
      out.push(e);
    } else if (source === "manual") {
      out.push(candidateHasValue ? withOriginSource(e, "override") : e);
    } else if (!candidateHasValue) {
      out.push(e);
    } else {
      out.push(withOriginSource(c, "auto-client"));
    }
  }

  return out.map((a, idx) => {
    const cAnswer = candidate[idx];
    const cChildren = cAnswer?.item;
    if (!a.item && !cChildren) return a;
    return { ...a, item: mergeItemsByOrigin(a.item ?? [], cChildren ?? []) };
  });
}

/**
 * Sets information-origin.source to the given code, preserving every other
 * sub-extension on an existing information-origin extension (notably author
 * on manual / override answers).
 */
function withOriginSource(
  answer: QuestionnaireResponseItemAnswer,
  source: OriginSource,
): QuestionnaireResponseItemAnswer {
  const otherExts = (answer.extension ?? []).filter(
    (e) => e.url !== INFORMATION_ORIGIN_URL,
  );
  const existingOrigin = (answer.extension ?? []).find(
    (e) => e.url === INFORMATION_ORIGIN_URL,
  );
  const subExts = (existingOrigin?.extension ?? []).filter(
    (e) => e.url !== "source",
  );
  const updatedOrigin: Extension = {
    url: INFORMATION_ORIGIN_URL,
    extension: [{ url: "source", valueCode: source }, ...subExts],
  };
  return { ...answer, extension: [...otherExts, updatedOrigin] };
}

/**
 * Stamps auto-client on a candidate item that has no peer in the existing QR.
 * Walks both item.item and answer.item so nested populated answers carry the
 * required information-origin extension.
 */
function stampNewItem(
  item: QuestionnaireResponseItem,
): QuestionnaireResponseItem {
  return {
    ...item,
    answer: item.answer?.map((a) => ({
      ...withOriginSource(a, "auto-client"),
      item: a.item?.map(stampNewItem),
    })),
    item: item.item?.map(stampNewItem),
  };
}

// -- Adaptive rounds --

/**
 * Fills populated answers into items that have no answer yet, stamping them
 * auto-client. Items that already hold a value are left as they are. The
 * adaptive loop re-populates the whole accumulated Questionnaire on every
 * $next-question round, and an earlier round's answers stay authoritative,
 * whether the user, the payer or a prior populate supplied them. Candidate
 * items with a value but no peer in the existing QR are appended.
 *
 * Pairing follows {@link applyPopulateResult}: by linkId, by occurrence
 * index among siblings, recursing into item.item and answer.item.
 */
export function fillUnansweredFromPopulate(
  existing: QuestionnaireResponse,
  candidate: QuestionnaireResponse,
): QuestionnaireResponse {
  const merged = structuredClone(existing);
  merged.item = fillItems(merged.item ?? [], candidate.item ?? []);
  return merged;
}

function fillItems(
  existingItems: QuestionnaireResponseItem[],
  candidateItems: QuestionnaireResponseItem[],
): QuestionnaireResponseItem[] {
  const candidatesByLinkId = new Map<string, QuestionnaireResponseItem[]>();
  for (const c of candidateItems) {
    const arr = candidatesByLinkId.get(c.linkId) ?? [];
    arr.push(c);
    candidatesByLinkId.set(c.linkId, arr);
  }
  const consumed = new Map<string, number>();
  const out: QuestionnaireResponseItem[] = [];

  for (const existing of existingItems) {
    const idx = consumed.get(existing.linkId) ?? 0;
    const cand = candidatesByLinkId.get(existing.linkId)?.[idx];
    consumed.set(existing.linkId, idx + 1);
    out.push(fillItem(existing, cand));
  }
  for (const [linkId, list] of candidatesByLinkId) {
    const used = consumed.get(linkId) ?? 0;
    for (let i = used; i < list.length; i++) {
      if (itemHasValue(list[i])) out.push(stampNewItem(list[i]));
    }
  }
  return out;
}

function fillItem(
  existing: QuestionnaireResponseItem,
  candidate: QuestionnaireResponseItem | undefined,
): QuestionnaireResponseItem {
  const out: QuestionnaireResponseItem = { ...existing };
  const existingAnswered = (existing.answer ?? []).some(
    (a) => extractAnswerValue(a) !== null,
  );
  const candidateAnswered = (candidate?.answer ?? []).some(
    (a) => extractAnswerValue(a) !== null,
  );

  if (!existingAnswered && candidateAnswered && candidate?.answer) {
    out.answer = candidate.answer.map((a) => ({
      ...withOriginSource(a, "auto-client"),
      item: a.item?.map(stampNewItem),
    }));
  } else if (existing.answer) {
    out.answer = existing.answer.map((a, i) => {
      const cChildren = candidate?.answer?.[i]?.item;
      if (!a.item && !cChildren) return a;
      return { ...a, item: fillItems(a.item ?? [], cChildren ?? []) };
    });
  }

  if (existing.item || candidate?.item) {
    out.item = fillItems(existing.item ?? [], candidate?.item ?? []);
  }
  return out;
}

function itemHasValue(item: QuestionnaireResponseItem): boolean {
  return (
    (item.answer ?? []).some(
      (a) =>
        extractAnswerValue(a) !== null || (a.item ?? []).some(itemHasValue),
    ) || (item.item ?? []).some(itemHasValue)
  );
}

/**
 * Stamps information-origin on answers of a $next-question response that
 * arrive without one. An answer whose value matches the answer at the same
 * linkId and position in `prior` (the QR sent to the payer) takes that
 * answer's origin extension, author included. Payers are not required to echo
 * extensions back, so without this the user's manual answers would be
 * relabelled. Any other answer was supplied by the payer and gets `fallback`.
 * Returns a deep clone.
 */
export function restoreOrigins(
  qr: QuestionnaireResponse,
  prior: QuestionnaireResponse | undefined,
  fallback: OriginSource,
): QuestionnaireResponse {
  const priorAnswers = new Map<string, QuestionnaireResponseItemAnswer[]>();
  function collect(items: QuestionnaireResponseItem[] | undefined): void {
    if (!items) return;
    for (const item of items) {
      if (item.answer) {
        const list = priorAnswers.get(item.linkId) ?? [];
        list.push(...item.answer);
        priorAnswers.set(item.linkId, list);
        for (const a of item.answer) collect(a.item);
      }
      collect(item.item);
    }
  }
  collect(prior?.item);

  const clone = structuredClone(qr);
  const seen = new Map<string, number>();
  function walk(items: QuestionnaireResponseItem[] | undefined): void {
    if (!items) return;
    for (const item of items) {
      for (const answer of item.answer ?? []) {
        const pos = seen.get(item.linkId) ?? 0;
        seen.set(item.linkId, pos + 1);
        const value = extractAnswerValue(answer);
        if (value !== null && !hasOriginExtension(answer)) {
          const match = priorAnswers.get(item.linkId)?.[pos];
          const matchOrigin =
            match && extractAnswerValue(match) === value
              ? match.extension?.find((e) => e.url === INFORMATION_ORIGIN_URL)
              : undefined;
          if (!answer.extension) answer.extension = [];
          answer.extension.push(
            matchOrigin
              ? structuredClone(matchOrigin)
              : makeOriginExtension(fallback),
          );
        }
        walk(answer.item);
      }
      walk(item.item);
    }
  }
  walk(clone.item);
  return clone;
}
