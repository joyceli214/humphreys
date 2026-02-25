"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { Role, User } from "@/lib/api/generated/types";
import { UserCreateDialog } from "@/components/users/user-create-dialog";
import { UserRoleDialog } from "@/components/users/user-role-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { useAuth } from "@/lib/auth/auth-context";

function statusClass(status: string) {
  if (status === "active") return "bg-emerald-100 text-emerald-700";
  if (status === "disabled") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

export default function UsersPage() {
  const { hasPermission } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const canReadRoles = hasPermission("roles:read");
  const canCreateUsers = hasPermission("users:create");
  const canUpdateUsers = hasPermission("users:update");
  const canAssignRoles = hasPermission("users:assign") && canReadRoles;

  const load = async () => {
    setLoading(true);
    try {
      const userRes = await apiClient.listUsers(new URLSearchParams({ q: search, page: "1", page_size: "20" }));
      setUsers(userRes.items);
      if (canReadRoles) {
        const roleRes = await apiClient.listRoles();
        setRoles(roleRes.items);
      } else {
        setRoles([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasPermission("users:read")) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  const roleMap = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  if (!hasPermission("users:read")) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">User Management</h1>
          <p className="text-sm text-muted-foreground">Manage users, statuses, and role assignments.</p>
        </div>
        {canCreateUsers && (
          <UserCreateDialog
            roles={roles}
            onCreate={async (payload) => {
              await apiClient.createUser(payload);
              await load();
            }}
          />
        )}
      </div>

      <div className="rounded-lg border border-border bg-white p-4 space-y-3">
        <div className="flex gap-2">
          <Input placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button variant="outline" onClick={load}>Search</Button>
        </div>

        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Status</Th>
              <Th>Roles</Th>
              <Th className="w-[220px]">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <Td colSpan={5}>Loading users...</Td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <Td colSpan={5}>No users found.</Td>
              </tr>
            )}
            {!loading &&
              users.map((user) => (
                <tr key={user.id}>
                  <Td>{user.full_name}</Td>
                  <Td>{user.email}</Td>
                  <Td>
                    <Badge className={statusClass(user.status)}>{user.status}</Badge>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((role) => (
                        <Badge key={role.id}>{roleMap.get(role.id)?.name ?? role.name}</Badge>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      {canUpdateUsers && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const next = user.status === "active" ? "disabled" : "active";
                            await apiClient.updateUserStatus(user.id, next);
                            await load();
                          }}
                        >
                          {user.status === "active" ? "Disable" : "Activate"}
                        </Button>
                      )}
                      {canAssignRoles && (
                        <UserRoleDialog
                          user={user}
                          roles={roles}
                          onSave={async (roleIDs) => {
                            await apiClient.setUserRoles(user.id, roleIDs);
                            await load();
                          }}
                        />
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
      </div>
    </section>
  );
}
