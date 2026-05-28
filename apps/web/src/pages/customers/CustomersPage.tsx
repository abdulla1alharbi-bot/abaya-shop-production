import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";

export function CustomersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          items: Array<{
            id: string;
            code: number;
            name: string;
            mobile: string;
            balanceFils: number;
          }>;
        };
      }>("/customers", { params: { limit: 200 } });
      return res.data.data.items;
    },
  });

  return (
    <div>
      <PageHeader
        title="العملاء"
        description="بحث سريع والرصيد المستحق لكل عميل."
        actions={
          <Button asChild size="sm">
            <Link to="/customers/new">
              <Plus className="me-1 h-4 w-4" />
              عميل جديد
            </Link>
          </Button>
        }
      />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-start font-medium">الكود</th>
              <th className="px-4 py-3 text-start font-medium">الاسم</th>
              <th className="px-4 py-3 text-start font-medium">الجوال</th>
              <th className="px-4 py-3 text-end font-medium">مستحق</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  جاري التحميل…
                </td>
              </tr>
            ) : !data?.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  لا عملاء بعد. أضف عميلاً أو سجّله من البيع.
                </td>
              </tr>
            ) : (
              data.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-mono text-muted-foreground">{c.code}</td>
                  <td className="px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground" dir="ltr">
                    {c.mobile}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{formatAED(c.balanceFils)}</td>
                  <td className="px-4 py-2.5 text-end">
                    <Link className="text-sm font-medium text-brand-700 underline" to={`/customers/${c.id}`}>
                      فتح
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
