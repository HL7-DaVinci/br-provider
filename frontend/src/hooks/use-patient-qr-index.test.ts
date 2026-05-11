import type { Extension, QuestionnaireResponse } from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  findCompletedQrsForView,
  findReusableQr,
  getOrderSatisfactionState,
  indexQrsByCanonical,
} from "./use-patient-qr-index";

const Q_BARE = "https://example.org/Questionnaire/Q";
const Q_VERSIONED = `${Q_BARE}|1.0.0`;
const QR_CONTEXT_EXT_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/qr-context";

function qr(
  id: string,
  questionnaire: string | undefined,
  status: QuestionnaireResponse["status"],
  options: { lastUpdated?: string; orderRef?: string } = {},
): QuestionnaireResponse {
  const ext: Extension[] = [];
  if (options.orderRef) {
    ext.push({
      url: QR_CONTEXT_EXT_URL,
      valueReference: { reference: options.orderRef },
    });
  }
  return {
    resourceType: "QuestionnaireResponse",
    id,
    questionnaire,
    status,
    meta: options.lastUpdated
      ? { lastUpdated: options.lastUpdated }
      : undefined,
    extension: ext.length ? ext : undefined,
  };
}

describe("indexQrsByCanonical", () => {
  it("buckets completed and in-progress QRs by canonical", () => {
    const completed = [qr("c1", Q_BARE, "completed")];
    const inProgress = [qr("p1", Q_BARE, "in-progress")];

    const map = indexQrsByCanonical(completed, inProgress);

    expect(map.get(Q_BARE)?.completed.map((q) => q.id)).toEqual(["c1"]);
    expect(map.get(Q_BARE)?.inProgress.map((q) => q.id)).toEqual(["p1"]);
  });

  it("sorts each bucket by meta.lastUpdated descending", () => {
    const map = indexQrsByCanonical(
      [
        qr("c-old", Q_BARE, "completed", { lastUpdated: "2024-01-01" }),
        qr("c-new", Q_BARE, "completed", { lastUpdated: "2024-12-01" }),
      ],
      [
        qr("p-old", Q_BARE, "in-progress", { lastUpdated: "2024-02-01" }),
        qr("p-new", Q_BARE, "in-progress", { lastUpdated: "2024-11-01" }),
      ],
    );
    expect(map.get(Q_BARE)?.completed.map((q) => q.id)).toEqual([
      "c-new",
      "c-old",
    ]);
    expect(map.get(Q_BARE)?.inProgress.map((q) => q.id)).toEqual([
      "p-new",
      "p-old",
    ]);
  });

  it("treats amended QRs as completed (caller is responsible for status filter)", () => {
    const completed = [
      qr("c1", Q_BARE, "completed"),
      qr("c2", Q_BARE, "amended"),
    ];
    const map = indexQrsByCanonical(completed, []);
    expect(map.get(Q_BARE)?.completed).toHaveLength(2);
  });

  it("ignores QRs without a questionnaire reference", () => {
    const map = indexQrsByCanonical([qr("c1", undefined, "completed")], []);
    expect(map.size).toBe(0);
  });

  it("normalizes versioned canonicals to the bare form on index", () => {
    const map = indexQrsByCanonical(
      [qr("c1", Q_VERSIONED, "completed")],
      [qr("p1", Q_VERSIONED, "in-progress")],
    );
    expect(map.get(Q_BARE)?.completed.map((q) => q.id)).toEqual(["c1"]);
    expect(map.get(Q_BARE)?.inProgress.map((q) => q.id)).toEqual(["p1"]);
    expect(map.get(Q_VERSIONED)).toBeUndefined();
  });

  it("merges versioned and unversioned QRs into the same bucket", () => {
    const map = indexQrsByCanonical(
      [
        qr("c1", Q_BARE, "completed", { lastUpdated: "2024-01-01" }),
        qr("c2", Q_VERSIONED, "completed", { lastUpdated: "2024-12-01" }),
      ],
      [],
    );
    expect(map.get(Q_BARE)?.completed.map((q) => q.id)).toEqual(["c2", "c1"]);
  });
});

describe("findReusableQr", () => {
  it("returns most-recent in-progress QR (sorted by lastUpdated)", () => {
    const map = indexQrsByCanonical(
      [],
      [
        qr("p-old", Q_BARE, "in-progress", { lastUpdated: "2024-01-01" }),
        qr("p-new", Q_BARE, "in-progress", { lastUpdated: "2024-12-01" }),
      ],
    );
    const result = findReusableQr(
      { byCanonical: map, isLoading: false },
      Q_BARE,
    );
    expect(result?.id).toBe("p-new");
  });

  it("returns undefined when only completed QRs exist (DTR completed-QR-reuse prohibition)", () => {
    const map = indexQrsByCanonical([qr("c1", Q_BARE, "completed")], []);
    const result = findReusableQr(
      { byCanonical: map, isLoading: false },
      Q_BARE,
    );
    expect(result).toBeUndefined();
  });

  it("falls back to stripped canonical when versioned lookup misses", () => {
    const map = indexQrsByCanonical([], [qr("p1", Q_BARE, "in-progress")]);
    const result = findReusableQr(
      { byCanonical: map, isLoading: false },
      Q_VERSIONED,
    );
    expect(result?.id).toBe("p1");
  });

  it("finds in-progress when QR is versioned and lookup canonical is bare", () => {
    const map = indexQrsByCanonical([], [qr("p1", Q_VERSIONED, "in-progress")]);
    const result = findReusableQr(
      { byCanonical: map, isLoading: false },
      Q_BARE,
    );
    expect(result?.id).toBe("p1");
  });
});

describe("getOrderSatisfactionState", () => {
  const order = "ServiceRequest/order-1";
  const otherOrder = "ServiceRequest/order-2";

  it("returns notStarted when no QR is linked to this order via qr-context", () => {
    const map = indexQrsByCanonical(
      [qr("c1", Q_BARE, "completed", { orderRef: otherOrder })],
      [],
    );
    expect(
      getOrderSatisfactionState(
        { byCanonical: map, isLoading: false },
        Q_BARE,
        order,
      ),
    ).toEqual({ kind: "notStarted" });
  });

  it("returns inProgressForThisOrder when an in-progress QR points at this order", () => {
    const map = indexQrsByCanonical(
      [],
      [qr("p1", Q_BARE, "in-progress", { orderRef: order })],
    );
    const state = getOrderSatisfactionState(
      { byCanonical: map, isLoading: false },
      Q_BARE,
      order,
    );
    expect(state.kind).toBe("inProgressForThisOrder");
    if (state.kind === "inProgressForThisOrder") {
      expect(state.qr.id).toBe("p1");
    }
  });

  it("returns completedForThisOrder when only completed QRs point at this order", () => {
    const map = indexQrsByCanonical(
      [qr("c1", Q_BARE, "completed", { orderRef: order })],
      [],
    );
    const state = getOrderSatisfactionState(
      { byCanonical: map, isLoading: false },
      Q_BARE,
      order,
    );
    expect(state.kind).toBe("completedForThisOrder");
    if (state.kind === "completedForThisOrder") {
      expect(state.qr.id).toBe("c1");
    }
  });

  it("prefers in-progress over completed when both exist for this order", () => {
    const map = indexQrsByCanonical(
      [qr("c1", Q_BARE, "completed", { orderRef: order })],
      [qr("p1", Q_BARE, "in-progress", { orderRef: order })],
    );
    const state = getOrderSatisfactionState(
      { byCanonical: map, isLoading: false },
      Q_BARE,
      order,
    );
    expect(state.kind).toBe("inProgressForThisOrder");
  });

  it("ignores QRs without a qr-context extension (DTR completed-QR-reuse prohibition)", () => {
    const map = indexQrsByCanonical([qr("c1", Q_BARE, "completed")], []);
    expect(
      getOrderSatisfactionState(
        { byCanonical: map, isLoading: false },
        Q_BARE,
        order,
      ),
    ).toEqual({ kind: "notStarted" });
  });

  it("returns completedForThisOrder when QR is versioned and lookup canonical is bare", () => {
    const map = indexQrsByCanonical(
      [qr("c1", Q_VERSIONED, "completed", { orderRef: order })],
      [],
    );
    const state = getOrderSatisfactionState(
      { byCanonical: map, isLoading: false },
      Q_BARE,
      order,
    );
    expect(state.kind).toBe("completedForThisOrder");
    if (state.kind === "completedForThisOrder") {
      expect(state.qr.id).toBe("c1");
    }
  });
});

describe("findCompletedQrsForView", () => {
  it("returns all completed QRs for the canonical, regardless of order linkage", () => {
    const map = indexQrsByCanonical(
      [
        qr("c1", Q_BARE, "completed", {
          orderRef: "ServiceRequest/x",
          lastUpdated: "2024-01-01",
        }),
        qr("c2", Q_BARE, "completed", { lastUpdated: "2024-12-01" }),
      ],
      [],
    );
    const list = findCompletedQrsForView(
      { byCanonical: map, isLoading: false },
      Q_BARE,
    );
    expect(list.map((q) => q.id)).toEqual(["c2", "c1"]);
  });
});
