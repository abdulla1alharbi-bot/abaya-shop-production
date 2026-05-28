/** Min/max length for stored login usernames (after trim + NFC + Latin case-fold). */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;

/**
 * Trim, Unicode NFC, and lowercase ASCII Latin letters only (A–Z → a–z).
 * Arabic and digits are unchanged — reliable comparison for mixed scripts.
 */
export function normalizeUsername(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const nfc = trimmed.normalize("NFC");
  return nfc.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Allowed after normalization: Arabic script, Latin a–z, digits, underscore */
const USERNAME_PATTERN = /^[\p{Script=Arabic}a-z0-9_]+$/u;

/**
 * Returns Arabic validation message or null if valid.
 * Call with already-normalized username when persisting or logging in.
 */
export function validateUsernameFormat(usernameNormalized: string): string | null {
  if (!usernameNormalized) {
    return "اسم المستخدم مطلوب";
  }
  if (usernameNormalized.length < USERNAME_MIN_LENGTH) {
    return `اسم المستخدم يجب أن يكون ${USERNAME_MIN_LENGTH} أحرف على الأقل`;
  }
  if (usernameNormalized.length > USERNAME_MAX_LENGTH) {
    return `اسم المستخدم يجب ألا يتجاوز ${USERNAME_MAX_LENGTH} حرفاً`;
  }
  if (!USERNAME_PATTERN.test(usernameNormalized)) {
    return "اسم المستخدم يحتوي على أحرف غير مسموحة (عربي أو إنجليزي وأرقام والشرطة السفلية فقط)";
  }
  return null;
}

export const USERNAME_TAKEN_MESSAGE = "اسم المستخدم مستخدم بالفعل";
