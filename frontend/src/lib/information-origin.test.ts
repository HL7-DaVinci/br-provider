import type {
  Extension,
  QuestionnaireResponse,
  QuestionnaireResponseItemAnswer,
} from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  applyOriginTracking,
  applyPopulateResult,
  buildOriginIndex,
  fillUnansweredFromPopulate,
  type OriginSource,
  restoreOrigins,
  stampOrigins,
} from "./information-origin";

const ORIGIN_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/information-origin";

function originExt(source: OriginSource, author?: string): Extension {
  const ext: Extension = {
    url: ORIGIN_URL,
    extension: [{ url: "source", valueCode: source }],
  };
  if (author) {
    ext.extension?.push({
      url: "author",
      valueReference: { reference: author },
    });
  }
  return ext;
}

function answer(
  value: string,
  source?: OriginSource,
  author?: string,
): QuestionnaireResponseItemAnswer {
  const a: QuestionnaireResponseItemAnswer = { valueString: value };
  if (source) a.extension = [originExt(source, author)];
  return a;
}

function qr(
  ...items: Array<{
    linkId: string;
    answers?: QuestionnaireResponseItemAnswer[];
  }>
): QuestionnaireResponse {
  return {
    resourceType: "QuestionnaireResponse",
    status: "in-progress",
    item: items.map((i) => ({ linkId: i.linkId, answer: i.answers })),
  };
}

const empty: QuestionnaireResponse = {
  resourceType: "QuestionnaireResponse",
  status: "in-progress",
};

function answerOf(
  result: QuestionnaireResponse,
  linkId: string,
): string | undefined {
  return result.item?.find((i) => i.linkId === linkId)?.answer?.[0]
    ?.valueString;
}

function originOf(
  result: QuestionnaireResponse,
  linkId: string,
): OriginSource | undefined {
  const answers = result.item?.find((i) => i.linkId === linkId)?.answer;
  if (!answers?.[0]) return undefined;
  const ext = answers[0].extension?.find((e) => e.url === ORIGIN_URL);
  return ext?.extension?.find((e) => e.url === "source")
    ?.valueCode as OriginSource;
}

function authorOf(
  result: QuestionnaireResponse,
  linkId: string,
): string | undefined {
  const answers = result.item?.find((i) => i.linkId === linkId)?.answer;
  const ext = answers?.[0]?.extension?.find((e) => e.url === ORIGIN_URL);
  return ext?.extension?.find((e) => e.url === "author")?.valueReference
    ?.reference;
}

describe("applyPopulateResult", () => {
  it("empty existing + candidate has value → adopt as auto-client", () => {
    const result = applyPopulateResult(
      empty,
      qr({ linkId: "1.1", answers: [answer("Roosevelt")] }),
    );
    expect(answerOf(result, "1.1")).toBe("Roosevelt");
    expect(originOf(result, "1.1")).toBe("auto-client");
  });

  it("empty existing + candidate empty → no items appear", () => {
    const result = applyPopulateResult(empty, empty);
    expect(result.item ?? []).toHaveLength(0);
  });

  it("auto-server existing + candidate has value → replace, mark auto-client", () => {
    const result = applyPopulateResult(
      qr({ linkId: "1.1", answers: [answer("Old", "auto-server")] }),
      qr({ linkId: "1.1", answers: [answer("New")] }),
    );
    expect(answerOf(result, "1.1")).toBe("New");
    expect(originOf(result, "1.1")).toBe("auto-client");
  });

  it("auto-server existing + candidate empty → keep existing", () => {
    const result = applyPopulateResult(
      qr({ linkId: "1.1", answers: [answer("Existing", "auto-server")] }),
      qr({ linkId: "1.1", answers: [] }),
    );
    expect(answerOf(result, "1.1")).toBe("Existing");
    expect(originOf(result, "1.1")).toBe("auto-server");
  });

  it("auto-client existing + candidate has value → replace, stays auto-client", () => {
    const result = applyPopulateResult(
      qr({ linkId: "1.1", answers: [answer("A", "auto-client")] }),
      qr({ linkId: "1.1", answers: [answer("B")] }),
    );
    expect(answerOf(result, "1.1")).toBe("B");
    expect(originOf(result, "1.1")).toBe("auto-client");
  });

  it("manual existing + candidate empty → keep manual unchanged", () => {
    const result = applyPopulateResult(
      qr({ linkId: "1.1", answers: [answer("User", "manual")] }),
      empty,
    );
    expect(answerOf(result, "1.1")).toBe("User");
    expect(originOf(result, "1.1")).toBe("manual");
  });

  it("manual existing + candidate has any value → upshift to override", () => {
    const result = applyPopulateResult(
      qr({ linkId: "1.1", answers: [answer("User", "manual")] }),
      qr({ linkId: "1.1", answers: [answer("Whatever")] }),
    );
    expect(answerOf(result, "1.1")).toBe("User");
    expect(originOf(result, "1.1")).toBe("override");
  });

  it("override existing + any candidate → unchanged", () => {
    const result = applyPopulateResult(
      qr({ linkId: "1.1", answers: [answer("Decisive", "override")] }),
      qr({ linkId: "1.1", answers: [answer("Whatever")] }),
    );
    expect(answerOf(result, "1.1")).toBe("Decisive");
    expect(originOf(result, "1.1")).toBe("override");
  });

  it("preserves information-origin.author when manual upshifts to override", () => {
    const result = applyPopulateResult(
      qr({
        linkId: "1.1",
        answers: [answer("Theodore-Smith", "manual", "Practitioner/dr-smith")],
      }),
      qr({ linkId: "1.1", answers: [answer("Roosevelt")] }),
    );
    expect(originOf(result, "1.1")).toBe("override");
    expect(authorOf(result, "1.1")).toBe("Practitioner/dr-smith");
  });

  it("recurses into nested groups under item.item", () => {
    const existing: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [
        {
          linkId: "g",
          item: [{ linkId: "g.1", answer: [answer("Old", "auto-server")] }],
        },
      ],
    };
    const candidate: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [
        {
          linkId: "g",
          item: [{ linkId: "g.1", answer: [answer("New")] }],
        },
      ],
    };
    const result = applyPopulateResult(existing, candidate);
    const child = result.item?.[0]?.item?.[0];
    expect(child?.answer?.[0]?.valueString).toBe("New");
    const ext = child?.answer?.[0]?.extension?.find(
      (e) => e.url === ORIGIN_URL,
    );
    expect(ext?.extension?.find((e) => e.url === "source")?.valueCode).toBe(
      "auto-client",
    );
  });

  it("pairs repeated items with the same linkId by occurrence index", () => {
    const existing: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [
        { linkId: "med", answer: [answer("Tacrolimus", "auto-server")] },
        { linkId: "med", answer: [answer("MyEdit", "manual")] },
      ],
    };
    const candidate: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [
        { linkId: "med", answer: [answer("TacrolimusFromCQL")] },
        { linkId: "med", answer: [answer("MyEdit")] },
      ],
    };
    const result = applyPopulateResult(existing, candidate);
    const occurrences = result.item?.filter((i) => i.linkId === "med") ?? [];
    expect(occurrences[0]?.answer?.[0]?.valueString).toBe("TacrolimusFromCQL");
    expect(
      occurrences[0]?.answer?.[0]?.extension?.[0]?.extension?.find(
        (e) => e.url === "source",
      )?.valueCode,
    ).toBe("auto-client");
    expect(occurrences[1]?.answer?.[0]?.valueString).toBe("MyEdit");
    expect(
      occurrences[1]?.answer?.[0]?.extension?.[0]?.extension?.find(
        (e) => e.url === "source",
      )?.valueCode,
    ).toBe("override");
  });

  it("appends extra candidate occurrences as new auto-client items", () => {
    const existing: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [{ linkId: "med", answer: [answer("A", "auto-server")] }],
    };
    const candidate: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [
        { linkId: "med", answer: [answer("A")] },
        { linkId: "med", answer: [answer("B")] },
      ],
    };
    const result = applyPopulateResult(existing, candidate);
    const occurrences = result.item?.filter((i) => i.linkId === "med") ?? [];
    expect(occurrences).toHaveLength(2);
    expect(occurrences[1]?.answer?.[0]?.valueString).toBe("B");
    expect(
      occurrences[1]?.answer?.[0]?.extension?.[0]?.extension?.find(
        (e) => e.url === "source",
      )?.valueCode,
    ).toBe("auto-client");
  });

  it("reconciles each answer slot independently in a mixed-origin array", () => {
    const existing: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [
        {
          linkId: "allergies",
          answer: [
            answer("Penicillin", "auto-server"),
            answer("Latex", "manual"),
            answer("Aspirin", "auto-client"),
          ],
        },
      ],
    };
    const candidate: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [{ linkId: "allergies", answer: [answer("PenicillinFromCQL")] }],
    };
    const result = applyPopulateResult(existing, candidate);
    const slots = result.item?.[0]?.answer ?? [];
    expect(slots[0]?.valueString).toBe("PenicillinFromCQL");
    expect(
      slots[0]?.extension?.[0]?.extension?.find((e) => e.url === "source")
        ?.valueCode,
    ).toBe("auto-client");
    expect(slots[1]?.valueString).toBe("Latex");
    expect(
      slots[1]?.extension?.[0]?.extension?.find((e) => e.url === "source")
        ?.valueCode,
    ).toBe("manual");
    expect(slots[2]?.valueString).toBe("Aspirin");
    expect(
      slots[2]?.extension?.[0]?.extension?.find((e) => e.url === "source")
        ?.valueCode,
    ).toBe("auto-client");
  });

  it("upshifts a manual answer only when CQL produces a value at the same position", () => {
    const existing: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [{ linkId: "allergies", answer: [answer("Latex", "manual")] }],
    };
    const candidate: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [{ linkId: "allergies", answer: [answer("LatexFromCQL")] }],
    };
    const result = applyPopulateResult(existing, candidate);
    expect(result.item?.[0]?.answer?.[0]?.valueString).toBe("Latex");
    expect(
      result.item?.[0]?.answer?.[0]?.extension?.[0]?.extension?.find(
        (e) => e.url === "source",
      )?.valueCode,
    ).toBe("override");
  });

  it("stamps auto-client on nested answer.item children of newly adopted items", () => {
    const candidate: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [
        {
          linkId: "repeat-group",
          answer: [
            {
              valueString: "Outer",
              item: [{ linkId: "child", answer: [answer("Nested")] }],
            },
          ],
        },
      ],
    };
    const result = applyPopulateResult(empty, candidate);
    const outerAnswer = result.item?.[0]?.answer?.[0];
    expect(
      outerAnswer?.extension?.[0]?.extension?.find((e) => e.url === "source")
        ?.valueCode,
    ).toBe("auto-client");
    const nested = outerAnswer?.item?.[0]?.answer?.[0];
    expect(
      nested?.extension?.[0]?.extension?.find((e) => e.url === "source")
        ?.valueCode,
    ).toBe("auto-client");
  });
});

describe("applyOriginTracking with authorRef", () => {
  function fromExported(value: string): QuestionnaireResponse {
    return {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [{ linkId: "1.1", answer: [{ valueString: value }] }],
    };
  }

  it("stamps origin.author on a manual answer (no snapshot)", () => {
    const result = applyOriginTracking(fromExported("UserTyped"), new Map(), {
      authorRef: "Practitioner/dr-smith",
    });
    const ext = result.item?.[0]?.answer?.[0]?.extension?.find(
      (e) =>
        e.url ===
        "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/information-origin",
    );
    expect(ext?.extension?.find((e) => e.url === "source")?.valueCode).toBe(
      "manual",
    );
    expect(
      ext?.extension?.find((e) => e.url === "author")?.valueReference
        ?.reference,
    ).toBe("Practitioner/dr-smith");
  });

  it("stamps origin.author on an override answer (changed from snapshot)", () => {
    const stamped = stampOrigins(fromExported("PrePopulated"), "auto-server");
    const snapshots = buildOriginIndex(stamped);
    const result = applyOriginTracking(fromExported("UserChanged"), snapshots, {
      authorRef: "Practitioner/dr-smith",
    });
    const ext = result.item?.[0]?.answer?.[0]?.extension?.find(
      (e) =>
        e.url ===
        "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/information-origin",
    );
    expect(ext?.extension?.find((e) => e.url === "source")?.valueCode).toBe(
      "override",
    );
    expect(
      ext?.extension?.find((e) => e.url === "author")?.valueReference
        ?.reference,
    ).toBe("Practitioner/dr-smith");
  });

  it("does not stamp origin.author on an unchanged auto-server answer", () => {
    const stamped = stampOrigins(fromExported("Same"), "auto-server");
    const snapshots = buildOriginIndex(stamped);
    const result = applyOriginTracking(fromExported("Same"), snapshots, {
      authorRef: "Practitioner/dr-smith",
    });
    const ext = result.item?.[0]?.answer?.[0]?.extension?.find(
      (e) =>
        e.url ===
        "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/information-origin",
    );
    expect(ext?.extension?.find((e) => e.url === "source")?.valueCode).toBe(
      "auto-server",
    );
    expect(ext?.extension?.find((e) => e.url === "author")).toBeUndefined();
  });

  it("omits author when authorRef is not provided (non-SMART dev launch)", () => {
    const result = applyOriginTracking(fromExported("UserTyped"), new Map());
    const ext = result.item?.[0]?.answer?.[0]?.extension?.find(
      (e) =>
        e.url ===
        "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/information-origin",
    );
    expect(ext?.extension?.find((e) => e.url === "source")?.valueCode).toBe(
      "manual",
    );
    expect(ext?.extension?.find((e) => e.url === "author")).toBeUndefined();
  });
});

function sourceOf(a: QuestionnaireResponseItemAnswer | undefined) {
  return a?.extension
    ?.find((e) => e.url === ORIGIN_URL)
    ?.extension?.find((e) => e.url === "source")?.valueCode;
}

function qrOf(items: QuestionnaireResponse["item"]): QuestionnaireResponse {
  return {
    resourceType: "QuestionnaireResponse",
    status: "in-progress",
    item: items,
  };
}

describe("fillUnansweredFromPopulate", () => {
  it("fills an unanswered item and stamps auto-client", () => {
    const merged = fillUnansweredFromPopulate(
      qrOf([{ linkId: "family" }]),
      qrOf([{ linkId: "family", answer: [answer("Smith")] }]),
    );
    const a = merged.item?.[0].answer?.[0];
    expect(a?.valueString).toBe("Smith");
    expect(sourceOf(a)).toBe("auto-client");
  });

  it("keeps an answered item regardless of its origin", () => {
    for (const source of ["manual", "auto-server", "override"] as const) {
      const merged = fillUnansweredFromPopulate(
        qrOf([{ linkId: "q", answer: [answer("mine", source)] }]),
        qrOf([{ linkId: "q", answer: [answer("cql")] }]),
      );
      expect(merged.item?.[0].answer).toEqual([answer("mine", source)]);
    }
  });

  it("appends candidate items with a value and skips empty ones", () => {
    const merged = fillUnansweredFromPopulate(
      qrOf([{ linkId: "a", answer: [answer("x", "manual")] }]),
      qrOf([
        { linkId: "a", answer: [answer("y")] },
        { linkId: "b", answer: [answer("new")] },
        { linkId: "c" },
      ]),
    );
    expect(merged.item?.map((i) => i.linkId)).toEqual(["a", "b"]);
    expect(sourceOf(merged.item?.[1].answer?.[0])).toBe("auto-client");
  });

  it("fills unanswered children inside a group", () => {
    const merged = fillUnansweredFromPopulate(
      qrOf([
        {
          linkId: "g",
          item: [
            { linkId: "kept", answer: [answer("k", "manual")] },
            { linkId: "empty" },
          ],
        },
      ]),
      qrOf([
        {
          linkId: "g",
          item: [
            { linkId: "kept", answer: [answer("cql-k")] },
            { linkId: "empty", answer: [answer("cql-e")] },
          ],
        },
      ]),
    );
    const children = merged.item?.[0].item;
    expect(children?.[0].answer?.[0].valueString).toBe("k");
    expect(children?.[1].answer?.[0].valueString).toBe("cql-e");
    expect(sourceOf(children?.[1].answer?.[0])).toBe("auto-client");
  });
});

describe("restoreOrigins", () => {
  it("restores the sent origin, author included, for an unchanged answer", () => {
    const sent = qrOf([
      { linkId: "q", answer: [answer("v", "manual", "Practitioner/1")] },
    ]);
    const restored = restoreOrigins(
      qrOf([{ linkId: "q", answer: [answer("v")] }]),
      sent,
      "auto-server",
    );
    expect(restored.item?.[0].answer?.[0]).toEqual(
      answer("v", "manual", "Practitioner/1"),
    );
  });

  it("uses the fallback for new or changed answers", () => {
    const restored = restoreOrigins(
      qrOf([
        { linkId: "q", answer: [answer("changed")] },
        { linkId: "new", answer: [answer("payer")] },
      ]),
      qrOf([{ linkId: "q", answer: [answer("v", "manual")] }]),
      "auto-server",
    );
    expect(sourceOf(restored.item?.[0].answer?.[0])).toBe("auto-server");
    expect(sourceOf(restored.item?.[1].answer?.[0])).toBe("auto-server");
  });

  it("leaves answers that already carry an origin alone", () => {
    const restored = restoreOrigins(
      qrOf([{ linkId: "q", answer: [answer("v", "override")] }]),
      qrOf([{ linkId: "q", answer: [answer("v", "manual")] }]),
      "auto-server",
    );
    expect(restored.item?.[0].answer?.[0]).toEqual(answer("v", "override"));
  });
});
