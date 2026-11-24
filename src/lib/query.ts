const MAX_PAGE = 10000;
const MAX_LIKE_BYTES = 50; // D1 rejects longer LIKE patterns

// Page: safe integer 1..MAX_PAGE; huge finite values clamp, anything else is 1.
export const parsePage = (raw: string | undefined): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  if (n > MAX_PAGE) return MAX_PAGE;
  return Number.isInteger(n) && n >= 1 ? n : 1;
};

// Escaped LIKE pattern (use with ESCAPE '!') capped to MAX_LIKE_BYTES UTF-8 bytes (whole characters, "%" wrappers included).
export const likePattern = (q: string): string => {
  const enc = new TextEncoder();
  let body = "";
  let bytes = 2;
  for (const ch of q) {
    const piece = /[!%_]/.test(ch) ? "!" + ch : ch;
    const n = enc.encode(piece).length;
    if (bytes + n > MAX_LIKE_BYTES) break;
    body += piece;
    bytes += n;
  }
  return `%${body}%`;
};
