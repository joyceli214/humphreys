"use client";

import React from "react";
import { FormEvent, useState } from "react";
import type { Role } from "@/lib/api/generated/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UserCreateDialog({ roles, onCreate }: { roles: Role[]; onCreate: (payload: { email: string; password: string; full_name: string; role_ids: string[]; status: string }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleIDs, setRoleIDs] = useState<string[]>([]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await onCreate({ email, password, full_name: fullName, role_ids: roleIDs, status: "active" });
    setOpen(false);
    setEmail("");
    setPassword("");
    setFullName("");
    setRoleIDs([]);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create User</Button>
      </DialogTrigger>
      <DialogContent>
        <form className="space-y-3" onSubmit={submit}>
          <DialogTitle className="text-lg font-semibold">Create User</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Enter user details and assign initial roles.
          </DialogDescription>
          <Input placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <div>
            <p className="text-sm mb-2">Assign Roles</p>
            <div className="grid grid-cols-2 gap-2 max-h-44 overflow-auto rounded border border-border p-2">
              {roles.map((role) => {
                const checked = roleIDs.includes(role.id);
                return (
                  <label className="flex items-center gap-2 text-sm" key={role.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setRoleIDs((prev) => (e.target.checked ? [...prev, role.id] : prev.filter((id) => id !== role.id)))
                      }
                    />
                    {role.name}
                  </label>
                );
              })}
            </div>
          </div>
          <Button className="w-full" type="submit">
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
