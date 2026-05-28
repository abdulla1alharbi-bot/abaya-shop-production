import { STANDARD_ABAYA_SIZES } from "@/components/pos/posConstants";

export type SizeMode = "STANDARD" | "CUSTOM";

/** One ready-made product line in the unified POS cart */
export interface RetailCartLine {
  kind: "retail";
  productId: string;
  name: string;
  qty: number;
  unitFils: number;
  discountFils: number;
  totalFils: number;
}

/** One tailoring job line in the unified POS cart */
export interface TailoringCartLine {
  kind: "tailoring";
  id: string;
  /** AbayaType.id from /abaya-catalog (legacy carts may still store code e.g. WALTER). */
  abayaTypeId: string;
  /** AbayaModel.id when type uses second-level model picker */
  abayaModelId: string;
  /** When type is Custom */
  customStyleText: string;
  rollId: string;
  meters: string;
  laceRollId: string;
  laceMeters: string;
  colorNote: string;
  sizeMode: SizeMode;
  standardSize: string;
  shoulder: string;
  chest: string;
  waist: string;
  hip: string;
  lengthVal: string;
  sleeve: string;
  saleAed: string;
  materialCostAed: string;
  dueDate: string;
  itemNotes: string;
  /** Saved profile measurement used for this line (checkout → job). */
  measurementId?: string | null;
  /** Optional reference to showroom display sample that inspired this tailoring order. */
  sourceDisplaySampleJobId?: string | null;
  sourceDisplayModelId?: string | null;
}

export type PosCartLine = RetailCartLine | TailoringCartLine;

export type TailoringDraft = Omit<TailoringCartLine, "kind" | "id">;

export function defaultDueDateInput(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 16);
}

export function emptyTailoringDraft(): TailoringDraft {
  return {
    abayaTypeId: "",
    abayaModelId: "",
    customStyleText: "",
    rollId: "",
    meters: "2",
    laceRollId: "",
    laceMeters: "1",
    colorNote: "",
    sizeMode: "STANDARD",
    standardSize: STANDARD_ABAYA_SIZES[10],
    shoulder: "",
    chest: "",
    waist: "",
    hip: "",
    lengthVal: "",
    sleeve: "",
    saleAed: "",
    materialCostAed: "0",
    dueDate: defaultDueDateInput(),
    itemNotes: "",
    measurementId: null,
    sourceDisplaySampleJobId: null,
    sourceDisplayModelId: null,
  };
}
