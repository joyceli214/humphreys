import { describe, expect, it } from "vitest";
import { billingProfileForEquipment } from "./billing-profiles";

describe("billingProfileForEquipment", () => {
  it("keeps speaker, woofer, CD, and radio labels in their intended profiles", () => {
    expect(billingProfileForEquipment("Tower Speaker Pair")?.id).toBe("speaker");
    expect(billingProfileForEquipment("Sub- Woofer")?.id).toBe("woofer");
    expect(billingProfileForEquipment("CD Multi- changer")?.id).toBe("cd-player");
    expect(billingProfileForEquipment("Wave Radio")?.id).toBe("wave-radio");
    expect(billingProfileForEquipment("Shortwave radio")).toBeUndefined();
  });
});
