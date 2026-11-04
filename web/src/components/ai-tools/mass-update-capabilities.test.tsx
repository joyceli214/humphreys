import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MassUpdateCapabilities } from "@/components/ai-tools/mass-update-capabilities";

afterEach(cleanup);

describe("MassUpdateCapabilities", () => {
  it("lists what Mass Update can do, open by default", () => {
    render(<MassUpdateCapabilities onExample={() => {}} />);
    expect(screen.getByText("What Mass Update can do")).toBeInTheDocument();
    expect(screen.getByRole("group")).toHaveAttribute("open");
    for (const label of [
      "Change status",
      "Add, change or remove line items",
      "Change the labour total or discount",
      "Change the location",
      "Generate Work Done"
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText(/from each job's repair logs/i)).toBeInTheDocument();
    expect(screen.getByText(/up to 10 jobs per request/i)).toBeInTheDocument();
  });

  it("passes the example text when an example is clicked", () => {
    const onExample = vi.fn();
    render(<MassUpdateCapabilities onExample={onExample} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Work Done for jobs 31152 and 31153." }));
    expect(onExample).toHaveBeenCalledWith("Generate Work Done for jobs 31152 and 31153.");
  });

  it("disables the examples when asked", () => {
    render(<MassUpdateCapabilities onExample={() => {}} disabled />);
    expect(screen.getByRole("button", { name: "Set jobs 31195 and 31196 to Ready for pickup." })).toBeDisabled();
  });
});
