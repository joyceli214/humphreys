import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EquipmentSearchAnswer } from "./ask-skill-answers";

afterEach(cleanup);

describe("EquipmentSearchAnswer", () => {
  it("lists the matched jobs with status, customer, make, model and serial", () => {
    render(
      <EquipmentSearchAnswer
        search={{
          brand: "Marantz",
          model_number: "2270",
          serial: "",
          total: 1,
          rows: [{ reference_id: 31351, status_name: "Received", customer_name: "Ann Lee", brand: "Marantz", model_number: "2270", serial_number: "123456" }]
        }}
      />
    );
    expect(screen.getByText(/for make Marantz, model 2270/)).toBeTruthy();
    expect(screen.getByText("#31351")).toBeTruthy();
    expect(screen.getByText("Received")).toBeTruthy();
    expect(screen.getByText("Ann Lee")).toBeTruthy();
    expect(screen.getByText("123456")).toBeTruthy();
  });

  it("says when nothing matched", () => {
    render(<EquipmentSearchAnswer search={{ brand: "", model_number: "", serial: "999", total: 0, rows: [] }} />);
    expect(screen.getByText("No jobs found for serial 999.")).toBeTruthy();
  });
});
