import municipalitiesByProvince from "./canadian-municipalities-2024.json";

// Statistics Canada, 2024 Census Subdivision Boundary File (municipalities and
// municipal equivalents). Province labels use their common English names.
// https://geo.statcan.gc.ca/geo_wa/rest/services/2024/lcsd000a24s_e/MapServer/0
export const canadianProvinces = Object.keys(municipalitiesByProvince).sort((a, b) => a.localeCompare(b));

export function municipalitiesForProvince(province: string): readonly string[] {
  return municipalitiesByProvince[province as keyof typeof municipalitiesByProvince] ?? [];
}
