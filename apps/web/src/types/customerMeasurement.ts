/** Latest row from GET /customers/:id/measurements?limit=1 */
export interface CustomerMeasurementRow {
  id: string;
  customerId: string;
  label: string | null;
  shoulder: number | null;
  chest: number | null;
  waist: number | null;
  hip: number | null;
  length: number | null;
  sleeve: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
