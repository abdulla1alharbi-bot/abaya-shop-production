/**
 * Dependency-free report export: CSV with a UTF-8 BOM so Arabic opens correctly
 * in Microsoft Excel (double-click → columns render right-to-left text fine).
 */

type Cell = string | number | null | undefined;

function escapeCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportRowsAsCsv(filename: string, headers: string[], rows: Cell[][]): void {
  const lines = [headers.map(escapeCell).join(","), ...rows.map((r) => r.map(escapeCell).join(","))];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Fils → display amount (e.g. 12345 → "123.45"). */
export function filsToAmount(fils: number | null | undefined): string {
  return ((fils ?? 0) / 100).toFixed(2);
}
