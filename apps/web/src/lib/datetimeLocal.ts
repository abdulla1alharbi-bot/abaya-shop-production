/**
 * Conversions for `<input type="datetime-local">`, which speaks shop-local wall
 * clock while the API speaks ISO/UTC.
 *
 * These live in lib rather than beside the workshop sheet that first needed them:
 * a file that exports both a component and plain helpers loses Fast Refresh
 * (react-hooks / react-refresh only-export-components), and two components use them.
 */

/** ISO instant → the `YYYY-MM-DDTHH:mm` string the input expects, in local time. */
export function toLocalDatetimeValue(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Input value → ISO instant, or undefined when the field was left empty. */
export function fromLocalDatetimeValue(local: string): string | undefined {
  if (!local.trim()) return undefined;
  return new Date(local).toISOString();
}
