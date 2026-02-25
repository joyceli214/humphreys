"use client";

import { useEffect, useState } from "react";
import type { Role, User } from "@/lib/api/generated/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function UserRoleDialog({
  user,
  roles,
  onSave
}: {
  user: User;
  roles: Role[];
  onSave: (roleIDs: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedRoleIDs, setSelectedRoleIDs] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setSelectedRoleIDs(user.roles.map((r) => r.id));
    }
  }, [open, user.roles, roles]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit Role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">Edit Roles</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Select one or more roles for this user.
        </DialogDescription>

        <div className="space-y-2 rounded border border-border p-3 max-h-56 overflow-auto">
          {roles.map((role) => (
            <label key={role.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedRoleIDs.includes(role.id)}
                onChange={(e) => {
                  setSelectedRoleIDs((prev) =>
                    e.target.checked ? [...prev, role.id] : prev.filter((id) => id !== role.id)
                  );
                }}
              />
              <span>{role.name}</span>
            </label>
          ))}
        </div>

        <Button
          className="w-full"
          onClick={async () => {
            if (selectedRoleIDs.length === 0) return;
            await onSave(selectedRoleIDs);
            setOpen(false);
          }}
        >
          Save Roles
        </Button>
      </DialogContent>
    </Dialog>
  );
}
