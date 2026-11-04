import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CharCounterInput } from "@/components/ai-tools/char-counter-input";

afterEach(cleanup);

function Harness({ multiline, limit }: { multiline?: boolean; limit: number }) {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="cc">Box</label>
      <CharCounterInput id="cc" multiline={multiline} limit={limit} value={value} onValueChange={setValue} aria-describedby="help" />
    </>
  );
}

describe("CharCounterInput", () => {
  it("renders an input with maxLength and a live 'n / limit' counter", () => {
    render(<Harness limit={200} />);
    const input = screen.getByLabelText("Box");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("maxLength", "200");
    expect(screen.getByText("0 / 200")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "hello" } });
    expect(screen.getByText("5 / 200")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "hello world" } });
    expect(screen.getByText("11 / 200")).toBeInTheDocument();
  });

  it("renders a textarea when multiline and links the counter for screen readers", () => {
    render(<Harness multiline limit={500} />);
    const box = screen.getByLabelText("Box");
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveAttribute("maxLength", "500");
    expect(box.getAttribute("aria-describedby")).toBe("help cc-counter");
    fireEvent.change(box, { target: { value: "abc" } });
    expect(screen.getByText("3 / 500")).toHaveAttribute("id", "cc-counter");
  });
});
