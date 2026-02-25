import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AuthProvider } from "@/lib/auth/auth-context";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

describe("AuthProvider", () => {
  it("renders children", () => {
    render(
      <AuthProvider>
        <div>child</div>
      </AuthProvider>
    );
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
