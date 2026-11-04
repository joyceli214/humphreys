import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AISearchRow } from "@/lib/ai-tools/types";

const runAISearch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: { runAISearch: (...args: unknown[]) => runAISearch(...args) }
}));

import { EmailJobSearch } from "@/components/ai-tools/email-job-search";

function row(reference_id: number, customer_name: string): AISearchRow {
  return {
    reference_id, customer_id: 1, customer_name, equipment_name: "Receiver", brand_names: [], model_number: "", serial_number: "",
    status_name: "Finished", status_group: "done", created_at: null, is_warranty: false, original_job_id: null,
    warranty_job_ids: [], customer_job_count: 1
  };
}

const response = (rows: AISearchRow[]) => ({ filters: {}, rows, total: rows.length, limit: 20, offset: 0, group_by: "none", groups: [] });
const ROWS = [row(31200, "Jane Doe"), row(41200, "Bob Ray")];

beforeEach(() => {
  vi.useFakeTimers();
  runAISearch.mockResolvedValue(response(ROWS));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  runAISearch.mockReset();
});

const input = () => screen.getByRole("combobox", { name: "Search by customer name or job #" });

async function type(value: string, wait = 250) {
  fireEvent.change(input(), { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(wait);
  });
}

function setup(props: Partial<React.ComponentProps<typeof EmailJobSearch>> = {}) {
  const onAdd = vi.fn();
  render(<EmailJobSearch selectedIds={[]} canAddMore onAdd={onAdd} {...props} />);
  return onAdd;
}

describe("EmailJobSearch", () => {
  it("debounces typing and searches customer names when letters are typed", async () => {
    setup();
    await type("j", 100);
    await type("ja", 100);
    expect(runAISearch).not.toHaveBeenCalled();
    await type("jan");
    expect(runAISearch).toHaveBeenCalledTimes(1);
    expect(runAISearch).toHaveBeenCalledWith({ customer_name: "jan", limit: 20 });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /#31200.*Jane Doe/ })).toBeInTheDocument();
  });

  it("searches by job number suffix for digits only", async () => {
    setup();
    await type("#1200");
    expect(runAISearch).toHaveBeenCalledWith({ job_suffix: "1200", limit: 20 });
    expect(screen.queryByText(/at least 3 digits/)).toBeNull();
  });

  it("still searches with fewer than 3 digits but shows a hint", async () => {
    setup();
    await type("12");
    expect(runAISearch).toHaveBeenCalledWith({ job_suffix: "12", limit: 20 });
    expect(screen.getByText("Type at least 3 digits to narrow it down.")).toBeInTheDocument();
  });

  it("ignores stale responses that arrive after a newer search", async () => {
    let resolveFirst: (v: unknown) => void = () => undefined;
    runAISearch.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    runAISearch.mockResolvedValueOnce(response([row(41200, "Bob Ray")]));
    setup();
    await type("jane");
    await type("bob");
    await act(async () => resolveFirst(response([row(31200, "Jane Doe")])));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Bob Ray/ })).toBeInTheDocument();
    expect(screen.queryByText("Jane Doe")).toBeNull();
  });

  it("supports ArrowDown/ArrowUp/Enter and Escape", async () => {
    const onAdd = setup();
    await type("1200");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /#41200/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input()).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: /#31200/ }).id);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith(ROWS[0]);
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input()).toHaveAttribute("aria-expanded", "false");
  });

  it("adds a job on click but not one already picked or past the limit", async () => {
    const onAdd = setup({ selectedIds: [31200] });
    await type("1200");
    expect(screen.getByRole("option", { name: /#31200/ })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("option", { name: /#31200/ }));
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("option", { name: /#41200/ }));
    expect(onAdd).toHaveBeenCalledWith(ROWS[1]);
  });

  it("explains the 10-job limit", async () => {
    const onAdd = setup({ canAddMore: false });
    await type("1200");
    expect(screen.getByText(/10-job limit/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /#41200/ }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("shows an empty state and the server error", async () => {
    runAISearch.mockResolvedValueOnce(response([]));
    setup();
    await type("zzz");
    expect(screen.getByText("No matching jobs.")).toBeInTheDocument();
    runAISearch.mockRejectedValueOnce(new Error("boom"));
    await type("zzzz");
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("clearing the box closes the dropdown without searching", async () => {
    setup();
    await type("jane");
    await type("");
    expect(runAISearch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
