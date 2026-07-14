import { act, render, screen, waitFor } from "@testing-library/react";
import type { Questionnaire } from "fhir/r4";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LhcFormRenderer } from "./lhc-form-renderer";

vi.mock("@/lib/lhc-forms-loader", () => ({
  loadLhcForms: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/use-practitioner-ref", () => ({
  usePractitionerRef: () => undefined,
}));

const questionnaire: Questionnaire = {
  resourceType: "Questionnaire",
  status: "active",
  title: "Test Questionnaire",
};

function mockLForms(
  addFormToPage: (formDef: object, container: HTMLElement) => Promise<void>,
) {
  window.LForms = {
    Util: {
      convertFHIRQuestionnaireToLForms: vi.fn().mockReturnValue({}),
      mergeFHIRDataIntoLForms: vi.fn().mockReturnValue({}),
      addFormToPage: vi.fn(addFormToPage),
      getFormFHIRData: vi.fn().mockReturnValue({}),
    },
  };
}

describe("LhcFormRenderer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the form when addFormToPage settles", async () => {
    mockLForms((_formDef, container) => {
      container.appendChild(document.createElement("wc-lhc-form"));
      return Promise.resolve();
    });
    vi.useRealTimers();

    render(<LhcFormRenderer questionnaire={questionnaire} onSave={vi.fn()} />);

    await waitFor(() =>
      expect(screen.queryByText("Loading form...")).not.toBeInTheDocument(),
    );
    expect(document.querySelector("wc-lhc-form")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("shows an error instead of spinning forever when the form never becomes ready", async () => {
    mockLForms(() => new Promise(() => {}));

    render(<LhcFormRenderer questionnaire={questionnaire} onSave={vi.fn()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });

    expect(screen.getByText(/did not finish loading/i)).toBeInTheDocument();
    expect(screen.queryByText("Loading form...")).not.toBeInTheDocument();
  });
});
