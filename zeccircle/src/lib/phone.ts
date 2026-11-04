/**
 * Indian mobile numbers, in the format Bitrefill expects for top-ups: country code + number,
 * digits only (e.g. "919876543210"). Bitrefill cannot identify the operator without the 91 prefix.
 *
 * Accepts what people actually type: "+91 98765 43210", "098765-43210", "(987) 654 3210", "9876543210".
 */
export function normalizeIndianMobile(raw: string): string | null {
  // Remove every separator a person might type: spaces, dashes, dots, brackets, slashes.
  const compact = raw.trim().replace(/[\s\-().\/]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;

  let digits = compact.replace(/^\+/, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  else if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);

  // Indian mobile numbers are 10 digits and start with 6, 7, 8 or 9.
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `91${digits}`;
}

/** "919876543210" -> "+91 98765 43210" for messages. */
export function formatIndianMobile(normalized: string): string {
  const local = normalized.replace(/^91/, "");
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}
