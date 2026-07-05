import { describe, expect, it } from "vitest";
import {
  buildTaskFhirContext,
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

describe("buildTaskFhirContext", () => {
  it("includes the task.focus reference alongside the Task reference", () => {
    const context = buildTaskFhirContext({
      id: "task-1",
      focus: { reference: "ServiceRequest/order-1" },
    });
    expect(context.split(",")).toEqual(
      expect.arrayContaining(["Task/task-1", "ServiceRequest/order-1"]),
    );
  });

  it("includes additional refs alongside the Task and focus references", () => {
    const context = buildTaskFhirContext(
      { id: "task-1", focus: { reference: "ServiceRequest/order-1" } },
      ["Coverage/cov-1"],
    );
    expect(context.split(",")).toEqual([
      "Coverage/cov-1",
      "Task/task-1",
      "ServiceRequest/order-1",
    ]);
  });

  it("dedupes when an additional ref matches the focus reference", () => {
    const context = buildTaskFhirContext(
      { id: "task-1", focus: { reference: "ServiceRequest/order-1" } },
      ["Coverage/cov-1", "ServiceRequest/order-1"],
    );
    expect(context.split(",")).toEqual([
      "Coverage/cov-1",
      "ServiceRequest/order-1",
      "Task/task-1",
    ]);
  });

  it("omits the focus ref when the task has none", () => {
    const context = buildTaskFhirContext({ id: "task-1" }, ["Coverage/cov-1"]);
    expect(context).toBe("Coverage/cov-1,Task/task-1");
  });
});
