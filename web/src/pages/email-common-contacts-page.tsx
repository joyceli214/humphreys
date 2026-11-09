import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { EmailCommonContact, EmailCommonContactInput, EmailCommonContactRole } from "@/lib/api/generated/types";
import { useAlerts } from "@/lib/alerts/alert-context";
import { useAuth } from "@/lib/auth/auth-context";
import {
  EMAIL_CONTACT_NAME_MAX,
  EMAIL_CONTACT_ROLES,
  looksLikeEmail,
  roleBadgeClass,
  roleLabel,
  sortContacts
} from "@/lib/email-common-contacts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

type FormState = {
  id: number | null;
  name: string;
  email: string;
  role: EmailCommonContactRole;
  sortOrder: string;
  isPinned: boolean;
};

const EMPTY_FORM: FormState = { id: null, name: "", email: "", role: "staff", sortOrder: "0", isPinned: false };

function errText(err: unknown) {
  return err instanceof Error ? err.message : "Request failed";
}

export default function EmailCommonContactsPage() {
  const alerts = useAlerts();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("work_orders:update");
  const [items, setItems] = useState<EmailCommonContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EmailCommonContact | null>(null);
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("all");

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const res = await apiClient.listEmailCommonContacts();
        setItems(res.items ?? []);
      } catch (err) {
        alerts.error("Failed to load common contacts", errText(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [alerts, canManage]);

  const visible = useMemo(
    () =>
      sortContacts(items).filter((item) =>
        statusFilter === "all" ? true : statusFilter === "active" ? item.is_active : !item.is_active
      ),
    [items, statusFilter]
  );

  const replaceItem = (next: EmailCommonContact) => setItems((prev) => prev.map((item) => (item.id === next.id ? next : item)));

  const patch = async (item: EmailCommonContact, key: string, payload: Partial<EmailCommonContactInput>) => {
    setBusyKey(`${key}:${item.id}`);
    try {
      replaceItem(await apiClient.updateEmailCommonContact(item.id, payload));
    } catch (err) {
      alerts.error("Failed to update contact", errText(err));
    } finally {
      setBusyKey(null);
    }
  };

  const save = async () => {
    if (!form) return;
    const name = form.name.trim();
    const email = form.email.trim();
    const sortOrder = Number(form.sortOrder.trim() || "0");
    if (!name) return setFormError("Name is required.");
    if (name.length > EMAIL_CONTACT_NAME_MAX) return setFormError(`Name must be at most ${EMAIL_CONTACT_NAME_MAX} characters.`);
    if (!looksLikeEmail(email)) return setFormError("Enter a plain email address like name@example.com.");
    if (!Number.isInteger(sortOrder)) return setFormError("Sort order must be a whole number.");
    setSaving(true);
    setFormError("");
    const payload = { name, email, role: form.role, sort_order: sortOrder, is_pinned: form.isPinned };
    try {
      if (form.id === null) {
        const created = await apiClient.createEmailCommonContact(payload);
        setItems((prev) => [...prev, created]);
        alerts.success("Contact added");
      } else {
        replaceItem(await apiClient.updateEmailCommonContact(form.id, payload));
        alerts.success("Contact updated");
      }
      setForm(null);
    } catch (err) {
      setFormError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: EmailCommonContact) => {
    setBusyKey(`delete:${item.id}`);
    try {
      await apiClient.deleteEmailCommonContact(item.id);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      alerts.success("Contact deleted");
    } catch (err) {
      alerts.error("Failed to delete contact", errText(err));
    } finally {
      setBusyKey(null);
      setDeleteTarget(null);
    }
  };

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">You do not have permission to manage common contacts.</p>;
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">
          Common contacts <span className="text-lg font-normal text-muted-foreground">常用聯絡人</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          People you often copy on customer emails. Active contacts appear in the Management email drafts recipient picker.
        </p>
      </div>

      <article className="space-y-3 rounded-lg border border-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <select
            aria-label="Filter by status"
            className="h-9 rounded-md border border-input bg-white px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "active" | "inactive" | "all")}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <Button
            size="sm"
            onClick={() => {
              setFormError("");
              setForm({ ...EMPTY_FORM });
            }}
          >
            Add contact
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading common contacts...</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th className="w-[130px]">Role</Th>
                  <Th className="w-[160px]">Status</Th>
                  <Th className="w-[80px]">Sort</Th>
                  <Th className="w-[360px]">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <Td colSpan={6}>{items.length === 0 ? "No common contacts yet. Add one to get started." : "No contacts match this filter."}</Td>
                  </tr>
                )}
                {visible.map((item) => (
                  <tr key={item.id}>
                    <Td>{item.name}</Td>
                    <Td className="break-all">{item.email}</Td>
                    <Td>
                      <Badge className={roleBadgeClass(item.role)}>{roleLabel(item.role)}</Badge>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Badge className={item.is_active ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}>
                          {item.is_active ? "Active" : "Inactive"}
                        </Badge>
                        {item.is_pinned && <Badge className="bg-sky-100 text-sky-800">Pinned</Badge>}
                      </div>
                    </Td>
                    <Td>{item.sort_order}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setFormError("");
                            setForm({
                              id: item.id,
                              name: item.name,
                              email: item.email,
                              role: item.role,
                              sortOrder: String(item.sort_order),
                              isPinned: item.is_pinned
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyKey === `active:${item.id}`}
                          onClick={() => void patch(item, "active", { is_active: !item.is_active })}
                        >
                          {item.is_active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyKey === `pin:${item.id}`}
                          onClick={() => void patch(item, "pin", { is_pinned: !item.is_pinned })}
                        >
                          {item.is_pinned ? "Unpin" : "Pin to top"}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyKey === `delete:${item.id}`} onClick={() => setDeleteTarget(item)}>
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </article>

      <Dialog open={form !== null} onOpenChange={(open) => !open && !saving && setForm(null)}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">{form?.id === null ? "Add contact" : "Edit contact"}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Name, email and role are required. Emails are stored in lower case and must be unique.
          </DialogDescription>
          {form && (
            <form
              noValidate
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Name</span>
                <Input value={form.name} maxLength={EMAIL_CONTACT_NAME_MAX} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Email</span>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Role</span>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as EmailCommonContactRole })}
                  >
                    {EMAIL_CONTACT_ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label} {role.zh}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Sort order</span>
                  <Input type="number" step={1} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isPinned} onChange={(e) => setForm({ ...form, isPinned: e.target.checked })} />
                Pin to top
              </label>
              {formError && (
                <p role="alert" className="text-sm text-red-700">
                  {formError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setForm(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `${deleteTarget.name} <${deleteTarget.email}> will be removed. Deactivate instead to hide it from the picker but keep it.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTarget ? busyKey === `delete:${deleteTarget.id}` : false}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteTarget ? busyKey === `delete:${deleteTarget.id}` : false}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) void remove(deleteTarget);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
