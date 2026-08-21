import type {
  Bundle,
  Parameters,
  Questionnaire,
  QuestionnaireResponse,
  ValueSet,
} from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  alignChoiceAnswers,
  coerceDateAnswers,
  extractPackageBundles,
  inlineBundleValueSets,
  selectPackageBundle,
} from "./dtr-ingestion";

describe("extractPackageBundles", () => {
  function bundleWithQ(canonical: string, version?: string): Bundle {
    const q: Questionnaire = {
      resourceType: "Questionnaire",
      url: canonical,
      status: "active",
      ...(version ? { version } : {}),
    };
    return {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: q }],
    };
  }

  function paramsWith(...bundles: Bundle[]): Parameters {
    return {
      resourceType: "Parameters",
      parameter: bundles.map((resource) => ({
        name: "packagebundle",
        resource,
      })),
    };
  }

  it("returns an empty array for null/non-object input", () => {
    expect(extractPackageBundles(null)).toEqual([]);
    expect(extractPackageBundles(undefined)).toEqual([]);
    expect(extractPackageBundles("nope")).toEqual([]);
  });

  it("returns the input unchanged when given a Bundle directly", () => {
    const b = bundleWithQ("http://example.org/Q/A");
    expect(extractPackageBundles(b)).toEqual([b]);
  });

  it("unwraps a single packagebundle from a Parameters response", () => {
    const inner = bundleWithQ("http://example.org/Q/A");
    expect(extractPackageBundles(paramsWith(inner))).toEqual([inner]);
  });

  it("returns an empty array when Parameters has no packagebundle parameter", () => {
    const params: Parameters = {
      resourceType: "Parameters",
      parameter: [{ name: "outcome" }],
    };
    expect(extractPackageBundles(params)).toEqual([]);
  });

  it("returns every packagebundle from a two-package Parameters response", () => {
    const a = bundleWithQ("http://example.org/Q/A");
    const b = bundleWithQ("http://example.org/Q/B");
    expect(extractPackageBundles(paramsWith(a, b))).toEqual([a, b]);
  });
});

describe("selectPackageBundle", () => {
  function bundleWithQ(canonical: string, version?: string): Bundle {
    const q: Questionnaire = {
      resourceType: "Questionnaire",
      url: canonical,
      status: "active",
      ...(version ? { version } : {}),
    };
    return {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: q }],
    };
  }

  it("returns null for an empty bundle list", () => {
    expect(selectPackageBundle([])).toBeNull();
  });

  it("filters by canonical URL when multiple packagebundles are present", () => {
    const a = bundleWithQ("http://example.org/Q/A");
    const b = bundleWithQ("http://example.org/Q/B");
    expect(selectPackageBundle([a, b], "http://example.org/Q/B")).toBe(b);
    expect(selectPackageBundle([a, b], "http://example.org/Q/A")).toBe(a);
  });

  it("matches a versioned canonical request to an unversioned Questionnaire url", () => {
    const a = bundleWithQ("http://example.org/Q/A");
    const b = bundleWithQ("http://example.org/Q/B");
    expect(selectPackageBundle([a, b], "http://example.org/Q/B|1.0.0")).toBe(b);
  });

  it("matches a versioned canonical request to a versioned Questionnaire url when version matches", () => {
    const a = bundleWithQ("http://example.org/Q/A", "1.0.0");
    const b = bundleWithQ("http://example.org/Q/B", "1.0.0");
    expect(selectPackageBundle([a, b], "http://example.org/Q/B|1.0.0")).toBe(b);
  });

  it("falls back to the first packagebundle when no canonical matches", () => {
    const a = bundleWithQ("http://example.org/Q/A");
    const b = bundleWithQ("http://example.org/Q/B");
    expect(selectPackageBundle([a, b], "http://example.org/Q/Missing")).toBe(a);
  });

  it("returns the only packagebundle without applying canonical filter", () => {
    const a = bundleWithQ("http://example.org/Q/A");
    expect(selectPackageBundle([a], "http://example.org/Q/Other")).toBe(a);
  });
});

describe("inlineBundleValueSets", () => {
  const GENDER_VS = "http://hl7.org/fhir/ValueSet/administrative-gender";

  function expandedValueSet(url: string): ValueSet {
    return {
      resourceType: "ValueSet",
      url,
      status: "active",
      expansion: {
        timestamp: "2026-07-01T00:00:00Z",
        contains: [
          {
            system: "http://hl7.org/fhir/administrative-gender",
            code: "male",
            display: "Male",
          },
          {
            system: "http://hl7.org/fhir/administrative-gender",
            code: "female",
            display: "Female",
          },
        ],
      },
    };
  }

  function questionnaireWithChoice(answerValueSet: string): Questionnaire {
    return {
      resourceType: "Questionnaire",
      status: "active",
      item: [
        {
          linkId: "1",
          type: "group",
          item: [{ linkId: "1.gender", type: "choice", answerValueSet }],
        },
      ],
    };
  }

  function bundleWith(...resources: (Questionnaire | ValueSet)[]): Bundle {
    return {
      resourceType: "Bundle",
      type: "collection",
      entry: resources.map((resource) => ({ resource })),
    };
  }

  it("replaces answerValueSet with answerOption from the bundle's expansion", () => {
    const q = questionnaireWithChoice(GENDER_VS);
    const result = inlineBundleValueSets(
      q,
      bundleWith(expandedValueSet(GENDER_VS)),
    );

    const item = result.item?.[0].item?.[0];
    expect(item?.answerValueSet).toBeUndefined();
    expect(item?.answerOption).toEqual([
      {
        valueCoding: {
          system: "http://hl7.org/fhir/administrative-gender",
          code: "male",
          display: "Male",
        },
      },
      {
        valueCoding: {
          system: "http://hl7.org/fhir/administrative-gender",
          code: "female",
          display: "Female",
        },
      },
    ]);
  });

  it("matches versioned answerValueSet canonicals", () => {
    const q = questionnaireWithChoice(`${GENDER_VS}|4.0.1`);
    const result = inlineBundleValueSets(
      q,
      bundleWith(expandedValueSet(GENDER_VS)),
    );
    expect(result.item?.[0].item?.[0].answerOption).toHaveLength(2);
  });

  it("leaves items untouched when the bundle has no matching expansion", () => {
    const q = questionnaireWithChoice("http://example.org/ValueSet/other");
    const result = inlineBundleValueSets(
      q,
      bundleWith(expandedValueSet(GENDER_VS)),
    );
    const item = result.item?.[0].item?.[0];
    expect(item?.answerValueSet).toBe("http://example.org/ValueSet/other");
    expect(item?.answerOption).toBeUndefined();
  });

  it("inlines a contained ValueSet referenced as #id", () => {
    const q: Questionnaire = {
      resourceType: "Questionnaire",
      status: "active",
      contained: [
        {
          resourceType: "ValueSet",
          id: "administrative-gender",
          status: "active",
          expansion: {
            timestamp: "2024-01-01T00:00:00Z",
            contains: [
              {
                system: "http://hl7.org/fhir/administrative-gender",
                code: "male",
                display: "Male",
              },
            ],
          },
        },
      ],
      item: [
        {
          linkId: "gender",
          type: "choice",
          answerValueSet: "#administrative-gender",
        },
      ],
    };
    const result = inlineBundleValueSets(q, {
      resourceType: "Bundle",
      type: "collection",
    });
    expect(result.item?.[0].answerValueSet).toBeUndefined();
    expect(result.item?.[0].answerOption?.[0].valueCoding?.code).toBe("male");
  });

  it("does not mutate the input questionnaire", () => {
    const q = questionnaireWithChoice(GENDER_VS);
    inlineBundleValueSets(q, bundleWith(expandedValueSet(GENDER_VS)));
    expect(q.item?.[0].item?.[0].answerValueSet).toBe(GENDER_VS);
  });
});

describe("alignChoiceAnswers", () => {
  const MALE_CODING = {
    system: "http://hl7.org/fhir/administrative-gender",
    code: "male",
    display: "Male",
  };

  const questionnaire: Questionnaire = {
    resourceType: "Questionnaire",
    status: "active",
    item: [
      {
        linkId: "1",
        type: "group",
        item: [
          {
            linkId: "1.gender",
            type: "choice",
            answerOption: [{ valueCoding: MALE_CODING }],
          },
        ],
      },
    ],
  };

  function qrWithGenderAnswer(
    answer: Record<string, unknown>,
  ): QuestionnaireResponse {
    return {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [
        {
          linkId: "1",
          item: [{ linkId: "1.gender", answer: [answer] }],
        },
      ],
    };
  }

  it("replaces a bare string answer with the matching option coding", () => {
    const qr = qrWithGenderAnswer({ valueString: "male" });
    const result = alignChoiceAnswers(qr, questionnaire);
    const answer = result.item?.[0].item?.[0].answer?.[0];
    expect(answer?.valueString).toBeUndefined();
    expect(answer?.valueCoding).toEqual(MALE_CODING);
  });

  it("matches by display text case-insensitively", () => {
    const qr = qrWithGenderAnswer({ valueString: "MALE" });
    const result = alignChoiceAnswers(qr, questionnaire);
    expect(result.item?.[0].item?.[0].answer?.[0].valueCoding).toEqual(
      MALE_CODING,
    );
  });

  it("fills in the system for a system-less coding answer", () => {
    const qr = qrWithGenderAnswer({ valueCoding: { code: "male" } });
    const result = alignChoiceAnswers(qr, questionnaire);
    expect(result.item?.[0].item?.[0].answer?.[0].valueCoding).toEqual(
      MALE_CODING,
    );
  });

  it("preserves answer extensions when aligning", () => {
    const extension = [
      {
        url: "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/information-origin",
        extension: [{ url: "source", valueCode: "auto-server" }],
      },
    ];
    const qr = qrWithGenderAnswer({ valueString: "male", extension });
    const result = alignChoiceAnswers(qr, questionnaire);
    expect(result.item?.[0].item?.[0].answer?.[0].extension).toEqual(extension);
  });

  it("leaves unmatched answers and non-choice items untouched", () => {
    const qr = qrWithGenderAnswer({ valueString: "not-a-gender" });
    const result = alignChoiceAnswers(qr, questionnaire);
    expect(result.item?.[0].item?.[0].answer?.[0].valueString).toBe(
      "not-a-gender",
    );
    expect(result.item?.[0].item?.[0].answer?.[0].valueCoding).toBeUndefined();
  });
});

describe("coerceDateAnswers", () => {
  const questionnaire: Questionnaire = {
    resourceType: "Questionnaire",
    status: "active",
    item: [
      { linkId: "f2f", type: "date" },
      { linkId: "when", type: "dateTime" },
    ],
  };

  it("truncates a dateTime answer on a date item and leaves dateTime items alone", () => {
    const qr: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: [
        {
          linkId: "f2f",
          answer: [{ valueDateTime: "2020-07-01T10:40:10+01:00" }],
        },
        {
          linkId: "when",
          answer: [{ valueDateTime: "2020-07-01T10:40:10+01:00" }],
        },
      ],
    };
    const result = coerceDateAnswers(qr, questionnaire);
    expect(result.item?.[0].answer?.[0]).toEqual({ valueDate: "2020-07-01" });
    expect(result.item?.[1].answer?.[0].valueDateTime).toBe(
      "2020-07-01T10:40:10+01:00",
    );
    expect(qr.item?.[0].answer?.[0].valueDateTime).toBeDefined();
  });
});
