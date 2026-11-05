import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusPickList } from "@/components/ai-tools/status-pick-list";
import { EMPTY_SEARCH_FORM, formToFilters } from "@/lib/ai-tools/search-form";

const OPTIONS = ["Received", "In Progress", "Waiting for Parts", "Ready for Pickup", "Picked Up"];

afterEach(cleanup);

function Harness({ initial = [] as string[], options = OPTIONS, onChange = (_: string[]) => {} }) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <div>
      <button type="button">outside</button>
      <StatusPickList
        options={options}
        selected={selected}
        onChange={(next) => {
          setSelected(next);
          onChange(next);
        }}
      />
    </div>
  );
}

const trigger = () => screen.getByRole("button", { name: /^Status:/ });
const open = () => {
  fireEvent.click(trigger());
  return screen.getByRole("dialog", { name: "Choose statuses" });
};

describe("StatusPickList trigger label", () => {
  it("shows Any / the single name / a count", () => {
    const { rerender } = render(<StatusPickList options={OPTIONS} selected={[]} onChange={() => {}} />);
    expect(trigger()).toHaveTextContent("Status: Any");
    rerender(<StatusPickList options={OPTIONS} selected={["Received"]} onChange={() => {}} />);
    expect(trigger()).toHaveTextContent("Status: Received");
    rerender(<StatusPickList options={OPTIONS} selected={["Received", "Picked Up"]} onChange={() => {}} />);
    expect(trigger()).toHaveTextContent("Status: 2 selected");
  });

  it("exposes popup state to assistive tech and is closed by default", () => {
    render(<Harness />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("StatusPickList popover", () => {
  it("moves focus to the search box on open", () => {
    render(<Harness />);
    const dialog = open();
    expect(within(dialog).getByRole("searchbox", { name: "Search statuses" })).toHaveFocus();
  });

  it("toggles real labelled checkboxes and emits the same value array the chips did", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const dialog = open();
    const ready = within(dialog).getByRole("checkbox", { name: "Ready for Pickup" });
    expect(ready).not.toBeChecked();
    fireEvent.click(ready);
    expect(onChange).toHaveBeenLastCalledWith(["Ready for Pickup"]);
    expect(ready).toBeChecked();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Received" }));
    expect(onChange).toHaveBeenLastCalledWith(["Ready for Pickup", "Received"]);
    fireEvent.click(ready);
    expect(onChange).toHaveBeenLastCalledWith(["Received"]);
  });

  it("matches selected values case-insensitively and keeps unknown selected values removable", () => {
    const onChange = vi.fn();
    render(<Harness initial={["received", "Legacy Status"]} onChange={onChange} />);
    const dialog = open();
    expect(within(dialog).getByRole("checkbox", { name: "Received" })).toBeChecked();
    const legacy = within(dialog).getByRole("checkbox", { name: "Legacy Status" });
    expect(legacy).toBeChecked();
    fireEvent.click(legacy);
    expect(onChange).toHaveBeenLastCalledWith(["received"]);
  });

  it("filters the list by the search text", () => {
    render(<Harness />);
    const dialog = open();
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "pick" } });
    const names = within(dialog)
      .getAllByRole("checkbox")
      .map((box) => box.getAttribute("value"));
    expect(names).toEqual(["Ready for Pickup", "Picked Up"]);
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "zzz" } });
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(dialog).getByText("No matching statuses")).toBeInTheDocument();
  });

  it("Clear empties the selection", () => {
    const onChange = vi.fn();
    render(<Harness initial={["Received", "Picked Up"]} onChange={onChange} />);
    const dialog = open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(trigger()).toHaveTextContent("Status: Any");
  });

  it("Escape closes and returns focus to the trigger", () => {
    render(<Harness />);
    const dialog = open();
    fireEvent.keyDown(within(dialog).getByRole("searchbox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on an outside click but not on clicks inside", () => {
    render(<Harness />);
    const dialog = open();
    fireEvent.mouseDown(within(dialog).getByRole("searchbox"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on an outside touch", () => {
    render(<Harness />);
    open();
    fireEvent.touchStart(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a loading message when there are no options yet", () => {
    render(<Harness options={[]} />);
    const dialog = open();
    expect(within(dialog).getByText("Loading statuses...")).toBeInTheDocument();
  });
});

describe("StatusPickList tags", () => {
  it("shows removable tags for up to 3 selections", () => {
    const onChange = vi.fn();
    render(<Harness initial={["Received", "In Progress", "Picked Up"]} onChange={onChange} />);
    const tags = screen.getByRole("list", { name: "Selected statuses" });
    expect(within(tags).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(within(tags).getByRole("button", { name: "Remove In Progress" }));
    expect(onChange).toHaveBeenLastCalledWith(["Received", "Picked Up"]);
  });

  it("shows only the count when more than 3 are selected", () => {
    render(<Harness initial={["Received", "In Progress", "Picked Up", "Ready for Pickup"]} />);
    expect(screen.queryByRole("list", { name: "Selected statuses" })).toBeNull();
    expect(trigger()).toHaveTextContent("Status: 4 selected");
  });

  it("shows no tags when nothing is selected", () => {
    render(<Harness />);
    expect(screen.queryByRole("list", { name: "Selected statuses" })).toBeNull();
  });
});

describe("StatusPickList disabled", () => {
  it("does not open when disabled", () => {
    render(<StatusPickList options={OPTIONS} selected={["Received"]} onChange={() => {}} disabled />);
    expect(trigger()).toBeDisabled();
    fireEvent.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Received" })).toBeDisabled();
  });
});

describe("payload", () => {
  it("statuses picked in the list produce the same API filters", () => {
    let picked: string[] = [];
    render(<Harness onChange={(next) => (picked = next)} />);
    const dialog = open();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Received" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Ready for Pickup" }));
    expect(formToFilters({ ...EMPTY_SEARCH_FORM, statuses: picked })).toEqual({
      statuses: ["Received", "Ready for Pickup"],
      limit: 200
    });
  });
});
