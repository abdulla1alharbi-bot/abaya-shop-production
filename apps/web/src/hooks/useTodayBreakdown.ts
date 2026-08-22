import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Shape of GET /dashboard/today — the one request behind all four money drill-downs. */
export type TodayBreakdown = {
  collections: {
    totalFils: number;
    items: Array<{
      id: string;
      amountFils: number;
      method: string;
      at: string;
      invoiceId: string;
      invoiceNo: number;
      customerName: string | null;
    }>;
  };
  invoicedToday: {
    totalFils: number;
    paidFils: number;
    balanceFils: number;
    invoiceCount: number;
    tailoring: { totalFils: number; pieces: number };
    readyMade: { totalFils: number; pieces: number };
    items: Array<{
      id: string;
      invoiceNo: number;
      customerName: string | null;
      totalFils: number;
      paidFils: number;
      balanceFils: number;
      at: string;
      tailoringFils: number;
      pieces: Array<{ label: string; qty: number; totalFils: number; isTailoring: boolean }>;
    }>;
  };
  expenses: {
    totalFils: number;
    items: Array<{
      id: string;
      amountFils: number;
      description: string;
      category: string | null;
      at: string;
    }>;
  };
  wages: {
    totalFils: number;
    items: Array<{
      id: string;
      amountFils: number;
      stageKey: string;
      workerName: string;
      jobNo: number | null;
      productStyle: string | null;
      at: string | null;
    }>;
  };
};


export type TodayModal = "collections" | "invoiced" | "expenses" | "wages" | null;

/**
 * Lives here rather than beside the modal component so that editing the modal's
 * markup keeps Fast Refresh working — a file that exports both a component and a
 * hook gets fully remounted on every edit (react-refresh/only-export-components).
 */
export function useTodayBreakdown(enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "today"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: TodayBreakdown }>("/dashboard/today");
      return res.data.data;
    },
    enabled,
  });
}
