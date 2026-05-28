import { create } from "zustand";
import type {
  PosCartLine,
  RetailCartLine,
  TailoringCartLine,
  TailoringDraft,
} from "@/types/posCart";
import { emptyTailoringDraft } from "@/types/posCart";
import type { CustomerMeasurementRow } from "@/types/customerMeasurement";
import type { PosMeasurementHint } from "@/types/posMeasurementHint";
import { hintHasNumericBody } from "@/types/posMeasurementHint";

function newTailoringId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `tl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface CartState {
  lines: PosCartLine[];
  tailoringDraft: TailoringDraft;
  editingTailoringId: string | null;
  invoiceDiscountFils: number;

  /** POS-selected customer (shared with tailoring profile save / load). */
  posCustomerId: string | null;
  posCustomerLabel: string;
  /** Latest loaded measurement row id for PATCH updates. */
  latestProfileMeasurementId: string | null;

  setPosCustomer: (id: string | null, label: string) => void;
  setLatestProfileMeasurementId: (id: string | null) => void;
  /** Apply saved profile measurements into the tailoring draft (body fields). */
  hydrateTailoringFromMeasurement: (m: CustomerMeasurementRow | null) => void;
  /** Apply POS hint (measurement row or job-order JSON fallback). */
  applyPosMeasurementHint: (hint: PosMeasurementHint) => void;
  /** Clear body measurements when POS customer is cleared. */
  clearTailoringMeasurementFields: () => void;

  addRetailItem: (item: Omit<RetailCartLine, "kind">) => void;
  updateRetailQty: (productId: string, qty: number) => void;
  removeRetailLine: (productId: string) => void;

  setTailoringDraft: (partial: Partial<TailoringDraft>) => void;
  resetTailoringDraft: () => void;
  setEditingTailoringId: (id: string | null) => void;
  /** Merge draft into cart as new line or replace when editingTailoringId is set */
  commitTailoringDraft: () => { ok: true } | { ok: false; error: string };
  removeTailoringLine: (id: string) => void;
  startEditTailoringLine: (line: TailoringCartLine) => void;

  setInvoiceDiscount: (fils: number) => void;
  clear: () => void;
}

const initialState = {
  lines: [] as PosCartLine[],
  tailoringDraft: emptyTailoringDraft(),
  editingTailoringId: null as string | null,
  invoiceDiscountFils: 0,
  posCustomerId: null as string | null,
  posCustomerLabel: "",
  latestProfileMeasurementId: null as string | null,
};

function fStr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return String(n);
}

export const useCartStore = create<CartState>((set, get) => ({
  ...initialState,

  setPosCustomer: (id, label) =>
    set({ posCustomerId: id, posCustomerLabel: label }),

  setLatestProfileMeasurementId: (id) => set({ latestProfileMeasurementId: id }),

  hydrateTailoringFromMeasurement: (m) => {
    if (!m) {
      set({ latestProfileMeasurementId: null });
      return;
    }
    get().applyPosMeasurementHint({
      source: "measurement",
      measurementId: m.id,
      shoulder: m.shoulder,
      chest: m.chest,
      waist: m.waist,
      hip: m.hip,
      length: m.length,
      sleeve: m.sleeve,
      notes: m.notes,
    });
  },

  applyPosMeasurementHint: (hint) => {
    set((state) => {
      const hasBody = hintHasNumericBody(hint);
      const notesFromHint = hint.notes?.trim();
      return {
        latestProfileMeasurementId: hint.measurementId,
        tailoringDraft: {
          ...state.tailoringDraft,
          measurementId: hint.measurementId,
          sizeMode: hasBody ? "CUSTOM" : state.tailoringDraft.sizeMode,
          shoulder: fStr(hint.shoulder),
          chest: fStr(hint.chest),
          waist: fStr(hint.waist),
          hip: fStr(hint.hip),
          lengthVal: fStr(hint.length),
          sleeve: fStr(hint.sleeve),
          itemNotes:
            notesFromHint && !state.tailoringDraft.itemNotes.trim()
              ? notesFromHint
              : state.tailoringDraft.itemNotes,
        },
      };
    });
  },

  clearTailoringMeasurementFields: () =>
    set((state) => ({
      latestProfileMeasurementId: null,
      tailoringDraft: {
        ...state.tailoringDraft,
        measurementId: null,
        shoulder: "",
        chest: "",
        waist: "",
        hip: "",
        lengthVal: "",
        sleeve: "",
        sizeMode: "STANDARD",
      },
    })),

  addRetailItem: (item) => {
    if (!get().posCustomerId) return;
    set((state) => {
      const idx = state.lines.findIndex((l) => l.kind === "retail" && l.productId === item.productId);
      if (idx >= 0) {
        const next = [...state.lines];
        const cur = next[idx] as RetailCartLine;
        const qty = cur.qty + item.qty;
        next[idx] = {
          ...cur,
          qty,
          totalFils: Math.round((cur.unitFils - cur.discountFils) * qty),
        };
        return { lines: next };
      }
      return {
        lines: [...state.lines, { kind: "retail" as const, ...item }],
      };
    });
  },

  updateRetailQty: (productId, qty) => {
    if (qty <= 0) {
      get().removeRetailLine(productId);
      return;
    }
    set((state) => ({
      lines: state.lines.map((l) => {
        if (l.kind !== "retail" || l.productId !== productId) return l;
        return {
          ...l,
          qty,
          totalFils: Math.round((l.unitFils - l.discountFils) * qty),
        };
      }),
    }));
  },

  removeRetailLine: (productId) =>
    set((state) => ({
      lines: state.lines.filter((l) => !(l.kind === "retail" && l.productId === productId)),
    })),

  setTailoringDraft: (partial) =>
    set((state) => ({ tailoringDraft: { ...state.tailoringDraft, ...partial } })),

  resetTailoringDraft: () =>
    set({ tailoringDraft: emptyTailoringDraft(), editingTailoringId: null }),

  setEditingTailoringId: (id) => set({ editingTailoringId: id }),

  commitTailoringDraft: () => {
    const { tailoringDraft, editingTailoringId, posCustomerId } = get();
    const m = parseFloat(tailoringDraft.meters) || 2;
    if (!posCustomerId) {
      return { ok: false, error: "اختر العميل من السلة أولاً." };
    }
    if (!tailoringDraft.rollId) {
      return { ok: false, error: "اختر القماش (اللفة)." };
    }
    if (!Number.isFinite(m) || m <= 0) {
      return { ok: false, error: "بيانات القماش غير صالحة." };
    }
    if (!Number.isFinite(parseFloat(tailoringDraft.saleAed)) || parseFloat(tailoringDraft.saleAed) <= 0) {
      return { ok: false, error: "أدخل السعر بالدرهم." };
    }
    const due = new Date(tailoringDraft.dueDate);
    if (!tailoringDraft.dueDate?.trim() || Number.isNaN(due.getTime())) {
      return { ok: false, error: "حدد موعد التسليم." };
    }

    const metersNorm = String(parseFloat(tailoringDraft.meters) || 2);
    const line: TailoringCartLine = {
      kind: "tailoring",
      id: editingTailoringId ?? newTailoringId(),
      ...tailoringDraft,
      meters: metersNorm,
      materialCostAed: tailoringDraft.materialCostAed?.trim() || "0",
    };

    set((state) => {
      if (editingTailoringId) {
        return {
          lines: state.lines.map((l) =>
            l.kind === "tailoring" && l.id === editingTailoringId ? line : l,
          ),
          tailoringDraft: emptyTailoringDraft(),
          editingTailoringId: null,
        };
      }
      return {
        lines: [...state.lines, line],
        tailoringDraft: emptyTailoringDraft(),
        editingTailoringId: null,
      };
    });

    return { ok: true };
  },

  removeTailoringLine: (id) =>
    set((state) => ({
      lines: state.lines.filter((l) => !(l.kind === "tailoring" && l.id === id)),
      editingTailoringId: state.editingTailoringId === id ? null : state.editingTailoringId,
    })),

  startEditTailoringLine: (line) => {
    const { id, kind: _k, ...rest } = line;
    set({
      editingTailoringId: id,
      tailoringDraft: {
        ...rest,
        abayaModelId: rest.abayaModelId ?? "",
        customStyleText: rest.customStyleText ?? "",
      },
    });
  },

  setInvoiceDiscount: (invoiceDiscountFils) => set({ invoiceDiscountFils }),

  clear: () => set({ ...initialState }),
}));

export function subtotalFilsFromLines(lines: PosCartLine[]): number {
  return lines.reduce((a, l) => a + (l.kind === "retail" ? l.totalFils : Math.round((parseFloat(l.saleAed) || 0) * 100)), 0);
}
