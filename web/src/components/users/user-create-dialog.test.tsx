import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserCreateDialog } from "@/components/users/user-create-dialog";

describe("UserCreateDialog", () => {
  it("submits payload", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<UserCreateDialog roles={[{ id: "r1", name: "admin", description: "", is_system: false }]} onCreate={onCreate} />);

    fireEvent.click(screen.getByText("Create User"));
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "StrongPass123!" } });
    fireEvent.click(screen.getByLabelText("admin"));
    fireEvent.click(screen.getByText("Save"));

    expect(onCreate).toHaveBeenCalled();
  });
});
