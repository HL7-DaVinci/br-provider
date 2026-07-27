import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  HeaderEditor,
  headerEditorError,
  validCustomHeaders,
} from "./header-editor";

describe("headerEditorError", () => {
  it("rejects disallowed names", () => {
    expect(
      headerEditorError([{ name: "Expect", value: "100-continue" }]),
    ).toMatch(/Expect/);
  });

  it("rejects duplicate names case-insensitively", () => {
    expect(
      headerEditorError([
        { name: "X-One", value: "1" },
        { name: "x-one", value: "2" },
      ]),
    ).toMatch(/Duplicate/);
  });

  it("accepts a valid set and ignores incomplete rows", () => {
    expect(
      headerEditorError([
        { name: "X-Api-Key", value: "abc" },
        { name: "", value: "" },
      ]),
    ).toBeUndefined();
  });

  it("rejects a name with characters Headers.set() disallows", () => {
    expect(headerEditorError([{ name: "X Api Key", value: "abc" }])).toMatch(
      /not a valid header name/,
    );
  });

  it("rejects a value containing a newline", () => {
    expect(
      headerEditorError([{ name: "X-Api-Key", value: "abc\ndef" }]),
    ).toMatch(/invalid value/);
  });

  it("rejects a value with no name", () => {
    expect(headerEditorError([{ name: "", value: "abc" }])).toMatch(
      /needs a name/,
    );
  });
});

describe("validCustomHeaders", () => {
  it("drops rows without a name", () => {
    expect(
      validCustomHeaders([
        { name: "X-Api-Key", value: "abc" },
        { name: " ", value: "ignored" },
      ]),
    ).toEqual([{ name: "X-Api-Key", value: "abc" }]);
  });
});

describe("HeaderEditor", () => {
  it("adds a row and reports changes", () => {
    const onChange = vi.fn();
    render(<HeaderEditor headers={[]} onChange={onChange} idPrefix="prov" />);
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    expect(onChange).toHaveBeenCalledWith([{ name: "", value: "" }]);
  });

  it("shows the Authorization warning", () => {
    render(
      <HeaderEditor
        headers={[{ name: "Authorization", value: "Bearer x" }]}
        onChange={() => {}}
        idPrefix="prov"
      />,
    );
    expect(screen.getByText(/replaces this app's own token/)).toBeVisible();
  });

  it("shows an error for disallowed names", () => {
    render(
      <HeaderEditor
        headers={[{ name: "Host", value: "x" }]}
        onChange={() => {}}
        idPrefix="prov"
      />,
    );
    expect(screen.getByText(/cannot be forwarded/)).toBeVisible();
  });
});
