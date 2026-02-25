import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AuthProvider } from "@/lib/auth/auth-context";
import { MemoryRouter } from "react-router-dom";

describe("AuthProvider", () => {
  it("renders children", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <div>child</div>
        </AuthProvider>
      </MemoryRouter>
    );
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
