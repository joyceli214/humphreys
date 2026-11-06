import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AISearchFilters, AISearchRow } from "@/lib/ai-tools/types";
import { MassUpdateJobSearch } from "./mass-update-job-search";

const job: AISearchRow = {
  reference_id: 29275, customer_id: 1, customer_name: "Alex Example", equipment_name: "Receiver", brand_names: [],
  model_number: "", serial_number: "", status_name: "Received", status_group: "to_do", created_at: null,
  is_warranty: false, original_job_id: null, warranty_job_ids: [], customer_job_count: 1
};

function Harness({ searchJobs }: { searchJobs: (filters: AISearchFilters) => Promise<AISearchRow[]> }) {
  const [value, setValue] = useState("");
  return <><MassUpdateJobSearch value={value} onChange={setValue} searchJobs={searchJobs} /><output data-testid="selected-jobs">{value}</output></>;
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("MassUpdateJobSearch", () => {
  it("suggests customer matches and adds only the chosen job number to the instruction value", async () => {
    vi.useFakeTimers();
    const searchJobs = vi.fn().mockResolvedValue([job]);
    render(<Harness searchJobs={searchJobs} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Jobs" }), { target: { value: "Alex" } });
    expect(screen.getByTestId("selected-jobs")).toHaveTextContent("");
    await act(async () => vi.advanceTimersByTime(250));
    expect(searchJobs).toHaveBeenCalledWith({ customer_name: "Alex", limit: 20 });
    fireEvent.click(screen.getByRole("option", { name: /#29275 Alex Example/ }));
    expect(screen.getByTestId("selected-jobs")).toHaveTextContent("29275");
    expect(screen.getByRole("combobox", { name: "Jobs" })).toHaveValue("29275");
  });

  it("replaces the typed job-number suffix with the chosen job instead of keeping both", async () => {
    vi.useFakeTimers();
    const searchJobs = vi.fn().mockResolvedValue([job]);
    render(<Harness searchJobs={searchJobs} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Jobs" }), { target: { value: "275" } });
    await act(async () => vi.advanceTimersByTime(250));
    expect(searchJobs).toHaveBeenCalledWith({ job_suffix: "275", limit: 20 });
    fireEvent.click(screen.getByRole("option", { name: /#29275 Alex Example/ }));
    expect(screen.getByTestId("selected-jobs").textContent).toBe("29275");
    expect(screen.getByRole("combobox", { name: "Jobs" })).toHaveValue("29275");
  });

  it("keeps earlier picks when a second job is chosen by suffix", async () => {
    vi.useFakeTimers();
    const other: AISearchRow = { ...job, reference_id: 31221, customer_name: "Sam Sample" };
    const searchJobs = vi.fn().mockImplementation(async (filters: AISearchFilters) => (filters.job_suffix === "221" ? [other] : [job]));
    render(<Harness searchJobs={searchJobs} />);
    const input = screen.getByRole("combobox", { name: "Jobs" });
    fireEvent.change(input, { target: { value: "275" } });
    await act(async () => vi.advanceTimersByTime(250));
    fireEvent.click(screen.getByRole("option", { name: /#29275/ }));
    fireEvent.change(input, { target: { value: "221" } });
    await act(async () => vi.advanceTimersByTime(250));
    fireEvent.click(screen.getByRole("option", { name: /#31221/ }));
    expect(screen.getByTestId("selected-jobs").textContent).toBe("29275, 31221");
  });

  it("allows pasted job numbers without waiting for search", () => {
    const searchJobs = vi.fn().mockResolvedValue([]);
    render(<Harness searchJobs={searchJobs} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Jobs" }), { target: { value: "29275, 31221" } });
    expect(screen.getByTestId("selected-jobs")).toHaveTextContent("29275, 31221");
    expect(searchJobs).not.toHaveBeenCalled();
  });
});
