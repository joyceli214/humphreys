import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIClient } from "@/lib/api/client";

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Response;
}

describe("APIClient refresh retry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes and retries when api returns invalid token", async () => {
    const client = new APIClient();
    client.setAccessToken("expired-token");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(401, { error: "invalid token" }))
      .mockResolvedValueOnce(mockResponse(200, { access_token: "new-token", user: { id: "1" }, scope: [] }))
      .mockResolvedValueOnce(mockResponse(200, { items: [] }));

    const result = await client.listUsers(new URLSearchParams());

    expect(result).toEqual({ items: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/auth/refresh"),
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/users?"),
      expect.objectContaining({
        headers: expect.any(Headers)
      })
    );

    const thirdCallHeaders = (fetchSpy.mock.calls[2]?.[1] as RequestInit | undefined)?.headers as Headers;
    expect(thirdCallHeaders.get("Authorization")).toBe("Bearer new-token");
  });

  it("throws the original invalid token error when refresh fails", async () => {
    const client = new APIClient();
    client.setAccessToken("expired-token");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(401, { error: "invalid token" }))
      .mockResolvedValueOnce(mockResponse(401, { error: "invalid refresh token" }));

    await expect(client.listRoles()).rejects.toThrow("invalid token (401 /roles)");
  });

  it("deduplicates concurrent refresh calls", async () => {
    const client = new APIClient();
    client.setAccessToken("expired-token");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse(401, { error: "invalid token" }))
      .mockResolvedValueOnce(mockResponse(401, { error: "invalid token" }))
      .mockResolvedValueOnce(mockResponse(200, { access_token: "new-token", user: { id: "1" }, scope: [] }))
      .mockResolvedValueOnce(mockResponse(200, { items: [] }))
      .mockResolvedValueOnce(mockResponse(200, { items: [] }));

    await Promise.all([client.listRoles(), client.listPermissions()]);

    expect(fetchSpy).toHaveBeenCalledTimes(5);
    const refreshCalls = fetchSpy.mock.calls.filter((call) => call[0].toString().includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });
});

describe("parts audit API", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("loads work order history and filters individual requests", async () => {
    const client = new APIClient();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(200, []));
    expect(await client.getPartsPurchaseRequestHistory(123)).toEqual([]);
    expect(fetchSpy).toHaveBeenLastCalledWith(expect.stringContaining("/work-orders/123/parts-purchase-requests/history"), expect.any(Object));
    await client.getPartsPurchaseRequestHistory(123, 7);
    expect(fetchSpy).toHaveBeenLastCalledWith(expect.stringContaining("/work-orders/123/parts-purchase-requests/history?parts_purchase_request_id=7"), expect.any(Object));
  });
});
