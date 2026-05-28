import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { workTypeLabel } from "@/lib/jobOrderUi";

type WorkerRow = {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  isActive: boolean;
  specializations?: string | null;
};

type SummaryRow = {
  workerId: string;
  dueFils: number;
  earnedFils: number;
  taskCount: number;
};

export function WorkersPage() {
  const { data: workers, isLoading } = useQuery({
    queryKey: ["workers"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: WorkerRow[] };
      }>("/workers", { params: { limit: 500 } });
      return res.data.data.items;
    },
  });

  const { data: summaryData } = useQuery({
    queryKey: ["workers", "summary", "alltime"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: SummaryRow[] };
      }>("/workers/summary");
      return res.data.data.items;
    },
  });

  const dueById = new Map((summaryData ?? []).map((s) => [s.workerId, s]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="العمال"
        description="من يعمل في الورشة ومستحقاته التقريبية."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/payroll">المستحقات والدفعات</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/workers/new">
                <Plus className="me-1 h-4 w-4" />
                إضافة
              </Link>
            </Button>
          </div>
        }
      />

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-start font-medium">الاسم</th>
              <th className="px-4 py-3 text-start font-medium">الدور</th>
              <th className="px-4 py-3 text-start font-medium">التخصص</th>
              <th className="px-4 py-3 text-start font-medium">الجوال</th>
              <th className="px-4 py-3 text-end font-medium">مستحقات تقريبية</th>
              <th className="px-4 py-3 text-start font-medium">الحالة</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  جاري التحميل…
                </td>
              </tr>
            ) : !workers?.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  لا يوجد عمال بعد. أضف عاملاً لربطه بطلبات التفصيل وسجل القطع.
                </td>
              </tr>
            ) : (
              workers.map((w) => {
                const s = dueById.get(w.id);
                return (
                  <tr key={w.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">
                      <Link className="text-brand-700 underline hover:no-underline" to={`/workers/${w.id}`}>
                        {w.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{w.role}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-xs text-muted-foreground">
                      {w.specializations ? (
                        <span title={w.specializations}>
                          {(() => {
                            try {
                              const p = JSON.parse(w.specializations) as string[];
                              return Array.isArray(p) ? p.map((x) => workTypeLabel(x)).join("، ") : "—";
                            } catch {
                              return w.specializations;
                            }
                          })()}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{w.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-end font-semibold tabular-nums">
                      {s ? (
                        <span className={s.dueFils > 0 ? "text-amber-800 dark:text-amber-200" : ""}>
                          {formatAED(s.dueFils)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {w.isActive ? (
                        <Badge variant="secondary">نشط</Badge>
                      ) : (
                        <Badge variant="outline">موقوف</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end whitespace-nowrap">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/workers/${w.id}`}>تفاصيل</Link>
                      </Button>
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/workers/${w.id}/edit`}>تعديل</Link>
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        المستحقات = إجمالي أجور القطع المسجّلة + التعديلات − الدفعات. التفاصيل من صفحة العامل.
      </p>
    </div>
  );
}
