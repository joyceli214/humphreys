"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { DropdownManagementEntry } from "@/lib/api/generated/types";
import { useAlerts } from "@/lib/alerts/alert-context";
import { useAuth } from "@/lib/auth/auth-context";
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
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

export default function DropdownManagementPage() {
  const alerts = useAlerts();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("work_orders:update");
  const [items, setItems] = useState<DropdownManagementEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");
  const [freezeConfirmTarget, setFreezeConfirmTarget] = useState<{ key: string; label: string; nextFrozen: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingRow, setAddingRow] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newFloor, setNewFloor] = useState("0");

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const res = await apiClient.listDropdownManagement();
        setItems(res.items);
      } catch (err) {
        alerts.error("Failed to load dropdown management", err instanceof Error ? err.message : "Request failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [alerts, canManage]);

  const sortedItems = useMemo(() => [...items].sort((a, b) => a.label.localeCompare(b.label)), [items]);
  const selectedEntry = useMemo(
    () => sortedItems.find((entry) => entry.key === selectedKey) ?? sortedItems[0] ?? null,
    [selectedKey, sortedItems]
  );
  const filteredOptions = useMemo(() => {
    if (!selectedEntry) return [];
    const normalizedSearch = search.trim().toLowerCase();
    return selectedEntry.options.filter((option) => {
      if (statusFilter === "active" && !option.is_active) return false;
      if (statusFilter === "inactive" && option.is_active) return false;
      if (normalizedSearch && !option.label.toLowerCase().includes(normalizedSearch)) return false;
      return true;
    });
  }, [search, selectedEntry, statusFilter]);

  useEffect(() => {
    if (sortedItems.length === 0) {
      setSelectedKey("");
      return;
    }
    if (!selectedKey || !sortedItems.some((entry) => entry.key === selectedKey)) {
      setSelectedKey(sortedItems[0].key);
    }
  }, [selectedKey, sortedItems]);

  useEffect(() => {
    setAddingRow(false);
    setNewLabel("");
    setNewFloor("0");
  }, [selectedKey]);

  const setDropdownFrozen = async (key: string, isFrozen: boolean) => {
    const token = `freeze:${key}`;
    setBusyKey(token);
    try {
      await apiClient.setDropdownFrozen(key, isFrozen);
      setItems((prev) => prev.map((entry) => (entry.key === key ? { ...entry, is_frozen: isFrozen } : entry)));
      alerts.success(`${isFrozen ? "Froze" : "Unfroze"} dropdown`);
    } catch (err) {
      alerts.error("Failed to update freeze state", err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusyKey(null);
    }
  };

  const setOptionActive = async (key: string, optionID: number, isActive: boolean) => {
    const token = `option:${key}:${optionID}`;
    setBusyKey(token);
    try {
      await apiClient.setDropdownOptionActive(key, optionID, isActive);
      setItems((prev) =>
        prev.map((entry) =>
          entry.key !== key
            ? entry
            : {
                ...entry,
                options: entry.options.map((option) =>
                  option.id === optionID ? { ...option, is_active: isActive } : option
                )
              }
        )
      );
    } catch (err) {
      alerts.error("Failed to update option state", err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusyKey(null);
    }
  };

  const addOption = async () => {
    if (!selectedEntry) return;
    setAdding(true);
    try {
      if (selectedEntry.key === "locations") {
        const shelf = newLabel.trim();
        const floor = Number(newFloor.trim());
        if (!shelf) {
          alerts.error("Shelf required", "Enter a shelf value.");
          return;
        }
        if (!Number.isInteger(floor) || floor < 0) {
          alerts.error("Invalid floor", "Floor must be a whole number zero or greater.");
          return;
        }
        const created = await apiClient.createLocation({ shelf, floor });
        setItems((prev) =>
          prev.map((entry) =>
            entry.key !== selectedEntry.key
              ? entry
              : { ...entry, options: [...entry.options, { id: created.id, label: created.label, is_active: true }] }
          )
        );
      } else {
        const value = newLabel.trim();
        if (!value) {
          alerts.error("Value required", "Enter a value.");
          return;
        }
        const created =
          selectedEntry.key === "work_order_statuses"
            ? await apiClient.createWorkOrderStatus(value)
            : selectedEntry.key === "job_types"
              ? await apiClient.createJobType(value)
              : selectedEntry.key === "items"
                ? await apiClient.createItem(value)
                : selectedEntry.key === "brands"
                  ? await apiClient.createBrand(value)
                  : selectedEntry.key === "workers"
                    ? await apiClient.createWorker(value)
                    : selectedEntry.key === "payment_methods"
                      ? await apiClient.createPaymentMethod(value)
                      : selectedEntry.key === "parts_item_presets"
                        ? await apiClient.createPartsItemPreset(value)
                      : null;
        if (!created) {
          alerts.error("Unsupported dropdown", "Cannot add to this dropdown.");
          return;
        }
        setItems((prev) =>
          prev.map((entry) =>
            entry.key !== selectedEntry.key
              ? entry
              : { ...entry, options: [...entry.options, { id: created.id, label: created.label, is_active: true }] }
          )
        );
      }
      setNewLabel("");
      setNewFloor("0");
      setAddingRow(false);
      alerts.success("Option added");
    } catch (err) {
      alerts.error("Failed to add option", err instanceof Error ? err.message : "Request failed");
    } finally {
      setAdding(false);
    }
  };

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">You do not have permission to manage dropdown settings.</p>;
  }

  const addingLocation = selectedEntry?.key === "locations";

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Dropdown Management</h1>
        <p className="text-sm text-muted-foreground">Freeze dropdowns and activate/deactivate options.</p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading dropdown settings...</p>}

      {!loading && sortedItems.length === 0 && <p className="text-sm text-muted-foreground">No dropdowns found.</p>}

      {!loading && selectedEntry && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-lg border border-border bg-white p-3">
            <p className="mb-2 text-sm font-medium text-muted-foreground">Dropdowns</p>
            <div className="space-y-1">
              {sortedItems.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setSelectedKey(entry.key)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                    selectedEntry.key === entry.key ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                  }`}
                >
                  <span className="truncate">{entry.label}</span>
                  <Badge className={entry.is_frozen ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>
                    {entry.is_frozen ? "Frozen" : "Open"}
                  </Badge>
                </button>
              ))}
            </div>
          </aside>

          <article className="rounded-lg border border-border bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{selectedEntry.label}</h2>
                <Badge className={selectedEntry.is_frozen ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>
                  {selectedEntry.is_frozen ? "Frozen" : "Open"}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selectedEntry.is_frozen || addingRow}
                  onClick={() => {
                    setAddingRow(true);
                    setNewLabel("");
                    setNewFloor("0");
                  }}
                >
                  Add New
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyKey === `freeze:${selectedEntry.key}`}
                  onClick={() =>
                    setFreezeConfirmTarget({
                      key: selectedEntry.key,
                      label: selectedEntry.label,
                      nextFrozen: !selectedEntry.is_frozen
                    })
                  }
                >
                  {selectedEntry.is_frozen ? "Unfreeze" : "Freeze"}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px]">
              <div className="relative">
                <Input placeholder="Search options..." className="pr-8" value={search} onChange={(e) => setSearch(e.target.value)} />
                {search.length > 0 && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => setSearch("")}
                    aria-label="Clear option search"
                  >
                    ×
                  </button>
                )}
              </div>
              <select
                className="h-10 rounded-md border border-input bg-white px-3 py-2 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "active" | "inactive" | "all")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="all">All</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Option</Th>
                    <Th className="w-[140px]">Status</Th>
                    <Th className="w-[220px]">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {addingRow && (
                    <tr>
                      <Td>
                        {addingLocation ? (
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_120px]">
                            <Input
                              placeholder="New shelf (e.g. A12)"
                              value={newLabel}
                              onChange={(e) => setNewLabel(e.target.value)}
                            />
                            <Input type="number" min={0} placeholder="Floor" value={newFloor} onChange={(e) => setNewFloor(e.target.value)} />
                          </div>
                        ) : (
                          <Input
                            placeholder="New option label"
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                          />
                        )}
                      </Td>
                      <Td />
                      <Td>
                        <div className="flex gap-2">
                          <Button size="sm" type="button" onClick={() => void addOption()} disabled={adding}>
                            {adding ? "Saving..." : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            onClick={() => {
                              setAddingRow(false);
                              setNewLabel("");
                              setNewFloor("0");
                            }}
                            disabled={adding}
                          >
                            Cancel
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  )}
                  {filteredOptions.length === 0 && (
                    <tr>
                      <Td colSpan={3}>No options match your filters.</Td>
                    </tr>
                  )}
                  {filteredOptions.map((option) => (
                    <tr key={option.id}>
                      <Td>{option.label}</Td>
                      <Td>
                        <Badge className={option.is_active ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}>
                          {option.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyKey === `option:${selectedEntry.key}:${option.id}`}
                          onClick={() => void setOptionActive(selectedEntry.key, option.id, !option.is_active)}
                        >
                          {option.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </article>
        </div>
      )}

      <AlertDialog open={freezeConfirmTarget !== null} onOpenChange={(open) => !open && setFreezeConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{freezeConfirmTarget?.nextFrozen ? "Freeze dropdown?" : "Unfreeze dropdown?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {freezeConfirmTarget?.nextFrozen
                ? `This will hide "Add new" in the UI for ${freezeConfirmTarget?.label}.`
                : `This will allow users to add new options from the UI for ${freezeConfirmTarget?.label}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={freezeConfirmTarget ? busyKey === `freeze:${freezeConfirmTarget.key}` : false}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={freezeConfirmTarget ? busyKey === `freeze:${freezeConfirmTarget.key}` : false}
              onClick={(e) => {
                e.preventDefault();
                if (!freezeConfirmTarget) return;
                void setDropdownFrozen(freezeConfirmTarget.key, freezeConfirmTarget.nextFrozen).finally(() => {
                  setFreezeConfirmTarget(null);
                });
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
