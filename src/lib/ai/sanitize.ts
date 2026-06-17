/**
 * Sanitize a string before interpolating it into an AI prompt.
 *
 * Strips newlines and control characters so the value can't break out of its
 * quoted position in the prompt. Caps length to keep token use predictable.
 * Only escapes double-quotes so the enclosing `"..."` in the prompt stays intact.
 *
 * This is defense-in-depth for prompt injection. Combined with
 * structured-output schemas, it prevents externally-sourced niche names (or
 * other user-sourced strings) from hijacking the model's behavior.
 */
export function sanitizeForPrompt(value: string, maxLength = 120): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/"/g, '\\"')
    .trim()
    .slice(0, maxLength);
}
