/** GET /customers/:id/pos-measurement-hint */
export type PosMeasurementHintSource = "measurement" | "job_order" | "none";

export interface PosMeasurementHint {
  source: PosMeasurementHintSource;
  measurementId: string | null;
  jobOrderId?: string;
  shoulder: number | null;
  chest: number | null;
  waist: number | null;
  hip: number | null;
  length: number | null;
  sleeve: number | null;
  notes: string | null;
}

export function hintHasNumericBody(h: PosMeasurementHint): boolean {
  return (
    h.shoulder != null ||
    h.chest != null ||
    h.waist != null ||
    h.hip != null ||
    h.length != null ||
    h.sleeve != null
  );
}
