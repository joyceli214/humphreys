export function phoneDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function formatPhoneNumber(value: string | null | undefined) {
  const digits = phoneDigits(value);
  if (!digits) return "";

  const area = digits.slice(0, 3);
  const prefix = digits.slice(3, 6);
  const line = digits.slice(6, 10);

  if (digits.length <= 3) return `(${area}`;
  if (digits.length <= 6) return `(${area}) ${prefix}`;

  const formatted = `(${area}) ${prefix}-${line}`;
  return digits.length > 10 ? `${formatted} ${digits.slice(10)}` : formatted;
}
