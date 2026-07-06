import type { ClaimResponse, Task } from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  isTerminalTaskStatus,
  isWorklistTask,
  partitionTasks,
  taskAttachmentLabels,
  taskKind,
  taskPayerLabel,
  taskQuestionnaireLabel,
  taskTypeLabel,
  taskWaitingSummary,
} from "./task-worklist";

const PAS_TEMP = "http://hl7.org/fhir/us/davinci-pas/CodeSystem/PASTempCodes";

function makeTask(overrides: Partial<Task>): Task {
  return {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    ...overrides,
  };
}

function questionnaireTask(overrides: Partial<Task> = {}): Task {
  return makeTask({
    code: {
      coding: [{ system: PAS_TEMP, code: "attachment-request-questionnaire" }],
    },
    input: [
      {
        type: { coding: [{ system: PAS_TEMP, code: "questionnaire-context" }] },
        valueString: "urn:trn:12345",
      },
    ],
    ...overrides,
  });
}

function attachmentTask(overrides: Partial<Task> = {}): Task {
  return makeTask({
    code: { coding: [{ system: PAS_TEMP, code: "attachment-request-code" }] },
    input: [
      {
        type: { coding: [{ system: PAS_TEMP, code: "attachments-needed" }] },
        valueCodeableConcept: {
          coding: [
            {
              system: "http://loinc.org",
              code: "11488-4",
              display: "Consultation note",
            },
          ],
        },
      },
      {
        type: { coding: [{ system: PAS_TEMP, code: "attachments-needed" }] },
        valueCodeableConcept: {
          coding: [
            { system: "https://codesystem.x12.org/005010/755", code: "03" },
          ],
        },
      },
    ],
    ...overrides,
  });
}

function trackingTask(overrides: Partial<Task> = {}): Task {
  return makeTask(overrides);
}

describe("isTerminalTaskStatus / partitionTasks", () => {
  it("classifies terminal statuses", () => {
    for (const status of [
      "completed",
      "cancelled",
      "failed",
      "rejected",
      "entered-in-error",
    ]) {
      expect(isTerminalTaskStatus(status)).toBe(true);
    }
    expect(isTerminalTaskStatus("in-progress")).toBe(false);
    expect(isTerminalTaskStatus("requested")).toBe(false);
    expect(isTerminalTaskStatus(undefined)).toBe(false);
  });

  it("partitions tasks into active and closed", () => {
    const open = makeTask({ id: "a", status: "in-progress" });
    const done = makeTask({ id: "b", status: "completed" });
    const { active, closed } = partitionTasks([open, done]);
    expect(active).toEqual([open]);
    expect(closed).toEqual([done]);
  });
});

describe("isWorklistTask", () => {
  it("always includes documentation-request tasks, open or closed", () => {
    expect(isWorklistTask(questionnaireTask())).toBe(true);
    expect(isWorklistTask(questionnaireTask({ status: "completed" }))).toBe(
      true,
    );
    expect(isWorklistTask(attachmentTask({ status: "failed" }))).toBe(true);
  });

  it("includes tracking tasks only while open", () => {
    expect(isWorklistTask(trackingTask({ status: "in-progress" }))).toBe(true);
    expect(isWorklistTask(trackingTask({ status: "requested" }))).toBe(true);
    expect(isWorklistTask(trackingTask({ status: "completed" }))).toBe(false);
    expect(isWorklistTask(trackingTask({ status: "failed" }))).toBe(false);
  });
});

describe("taskKind / taskTypeLabel", () => {
  it("identifies the three task flavors", () => {
    expect(taskKind(questionnaireTask())).toBe("questionnaire");
    expect(taskKind(attachmentTask())).toBe("attachment");
    expect(taskKind(trackingTask())).toBe("tracking");
  });

  it("labels each flavor", () => {
    expect(taskTypeLabel(questionnaireTask())).toBe("Questionnaire requested");
    expect(taskTypeLabel(attachmentTask())).toBe("Documents requested");
    expect(taskTypeLabel(trackingTask())).toBe("PA status");
  });
});

describe("taskPayerLabel", () => {
  it("prefers requester display, falls back to identifier value", () => {
    expect(
      taskPayerLabel(
        makeTask({
          requester: { display: "Acme Health", identifier: { value: "789" } },
        }),
      ),
    ).toBe("Acme Health");
    expect(
      taskPayerLabel(makeTask({ requester: { identifier: { value: "789" } } })),
    ).toBe("789");
    expect(taskPayerLabel(makeTask({}))).toBeUndefined();
  });
});

describe("taskQuestionnaireLabel / taskAttachmentLabels", () => {
  it("prefers Task.description, then the formatted first context", () => {
    expect(
      taskQuestionnaireLabel(
        questionnaireTask({ description: "Home O2 form" }),
      ),
    ).toBe("Home O2 form");
    expect(taskQuestionnaireLabel(questionnaireTask())).toBe("urn:trn:12345");
    expect(taskQuestionnaireLabel(makeTask({}))).toBe("Documentation Request");
  });

  it("collects attachment code displays with code fallback", () => {
    expect(taskAttachmentLabels(attachmentTask())).toEqual([
      "Consultation note",
      "03",
    ]);
  });
});

describe("taskWaitingSummary", () => {
  it("summarizes open documentation tasks as waiting on the user", () => {
    expect(
      taskWaitingSummary(questionnaireTask({ description: "O2 form" })),
    ).toBe("Waiting on you: complete O2 form");
    expect(taskWaitingSummary(attachmentTask())).toBe(
      "Waiting on you: attach Consultation note, 03",
    );
  });

  it("summarizes tracking tasks by pend state", () => {
    expect(taskWaitingSummary(trackingTask({ status: "in-progress" }))).toBe(
      "Waiting on payer decision",
    );
    expect(taskWaitingSummary(trackingTask({ status: "requested" }))).toBe(
      "Waiting on payer response",
    );
    const pended: ClaimResponse = {
      resourceType: "ClaimResponse",
      status: "active",
      type: { text: "professional" },
      use: "preauthorization",
      patient: { reference: "Patient/1" },
      created: "2026-07-01",
      insurer: { reference: "Organization/payer" },
      outcome: "queued",
    };
    expect(
      taskWaitingSummary(trackingTask({ status: "requested" }), pended),
    ).toBe("Waiting on payer decision");
  });

  it("summarizes terminal tasks by outcome", () => {
    expect(taskWaitingSummary(trackingTask({ status: "completed" }))).toBe(
      "Prior authorization approved",
    );
    expect(taskWaitingSummary(questionnaireTask({ status: "completed" }))).toBe(
      "Documentation submitted to payer",
    );
    expect(
      taskWaitingSummary(
        trackingTask({
          status: "failed",
          statusReason: { text: "Not covered" },
        }),
      ),
    ).toBe("Not covered");
    expect(taskWaitingSummary(trackingTask({ status: "failed" }))).toBe(
      "Prior authorization denied",
    );
    expect(taskWaitingSummary(trackingTask({ status: "cancelled" }))).toBe(
      "Request cancelled",
    );
  });
});
