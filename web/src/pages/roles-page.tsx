"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { Permission, Role } from "@/lib/api/generated/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth/auth-context";

export default function RolesPage() {
  const { hasPermission } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, string[]>>({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const canReadPermissions = hasPermission("permissions:read");
  const canCreateRoles = hasPermission("roles:create");
  const canAssignRolePerms = hasPermission("roles:assign") && canReadPermissions;
  const canDeleteRoles = hasPermission("roles:delete");

  const load = async () => {
    const r = await apiClient.listRoles();
    setRoles(r.items);
    if (canReadPermissions) {
      const p = await apiClient.listPermissions();
      setPermissions(p.items);
    } else {
      setPermissions([]);
    }
    setPermissionDrafts(
      Object.fromEntries(
        r.items.map((role) => [role.id, (role.permissions ?? []).map((perm) => perm.id)])
      )
    );
  };

  useEffect(() => {
    if (!hasPermission("roles:read")) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  const byResource = useMemo(() => {
    return permissions.reduce<Record<string, Permission[]>>((acc, perm) => {
      acc[perm.resource] = acc[perm.resource] ?? [];
      acc[perm.resource].push(perm);
      return acc;
    }, {});
  }, [permissions]);

  const createRole = async (e: FormEvent) => {
    e.preventDefault();
    await apiClient.createRole({ name, description });
    setName("");
    setDescription("");
    await load();
  };

  if (!hasPermission("roles:read")) {
    return null;
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Role Management</h1>
      {canCreateRoles && (
        <form onSubmit={createRole} className="rounded-lg border border-border bg-white p-4 grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input placeholder="Role name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} required />
          <Button type="submit">Create Role</Button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {roles.map((role) => (
          <article key={role.id} className="rounded-lg border border-border bg-white p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">{role.name}</h2>
                <p className="text-sm text-muted-foreground">{role.description}</p>
              </div>
              {role.is_system && <Badge>System</Badge>}
            </div>

            <div className="space-y-2">
              {Object.entries(byResource).map(([resource, perms]) => (
                <div key={resource} className="flex items-center justify-between gap-4 border rounded-md border-border p-2">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium capitalize">{resource}</p>
                    <label className="text-xs flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={perms.every((perm) => (permissionDrafts[role.id] ?? []).includes(perm.id))}
                        disabled={role.name.toLowerCase() === "owner" || !canAssignRolePerms}
                        onChange={(e) => {
                          setPermissionDrafts((prev) => {
                            const current = new Set(prev[role.id] ?? []);
                            if (e.target.checked) {
                              for (const perm of perms) current.add(perm.id);
                            } else {
                              for (const perm of perms) current.delete(perm.id);
                            }
                            return { ...prev, [role.id]: Array.from(current) };
                          });
                        }}
                      />
                      Select all
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {perms.map((p) => {
                      const checked = (permissionDrafts[role.id] ?? []).includes(p.id);
                      const isOwnerRole = role.name.toLowerCase() === "owner";
                      return (
                        <label key={p.id} className="text-xs flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isOwnerRole || !canAssignRolePerms}
                            onChange={(e) => {
                              setPermissionDrafts((prev) => {
                                const current = new Set(prev[role.id] ?? []);
                                if (e.target.checked) current.add(p.id);
                                else current.delete(p.id);
                                return { ...prev, [role.id]: Array.from(current) };
                              });
                            }}
                          />
                          {p.action}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {!role.is_system && (
              <div className="flex gap-2">
                {canAssignRolePerms && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await apiClient.setRolePermissions(role.id, permissionDrafts[role.id] ?? []);
                      await load();
                    }}
                  >
                    Save Permissions
                  </Button>
                )}
                {canDeleteRoles && (
                  <Button variant="outline" onClick={async () => { await apiClient.deleteRole(role.id); await load(); }}>
                    Delete Role
                  </Button>
                )}
              </div>
            )}
            {role.name.toLowerCase() === "owner" && (
              <p className="text-xs text-muted-foreground">Owner permissions are locked and cannot be changed.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
