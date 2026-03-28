import { describe, expect, it } from "vitest";
import {
  parseQuestionnaireSearch,
  serializeQuestionnaireSearch,
} from "./dtr-search";

describe("dtr search helpers", () => {
  it("serializes all questionnaire canonicals into search state", () => {
    expect(
      serializeQuestionnaireSearch([
        "http://example.org/Questionnaire/a",
        "http://example.org/Questionnaire/b",
      ]),
    ).toBe(
      "http://example.org/Questionnaire/a,http://example.org/Questionnaire/b",
    );
  });

  it("parses all questionnaire canonicals from search state", () => {
    expect(
      parseQuestionnaireSearch(
        "http://example.org/Questionnaire/a,http://example.org/Questionnaire/b",
      ),
    ).toEqual([
      "http://example.org/Questionnaire/a",
      "http://example.org/Questionnaire/b",
    ]);
  });
});
