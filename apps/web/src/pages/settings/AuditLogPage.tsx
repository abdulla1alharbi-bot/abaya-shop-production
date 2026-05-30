import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

type AuditEntry = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  user: { id: string; name: string; username: string; role: string };
};

const ACTION_COLORS: Record<string, string> = {
  INVOICE_VOID: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  PAYMENT_ADDED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  STAGE_REOPEN: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  WORKER_PAYOUT: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  USER_UPDATED: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

export function AuditLogPage() {
  const { t } = useTranslation();
  const [filterEntity, setFilterEntity] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", filterEntity, filterAction, offset],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: AuditEntry[]; total: number; limit: number; offset: number };
      }>("/audit", {
        params: {
          entity: filterEntity || undefined,
          action: filterAction || undefined,
          limit,
          offset,
        },
      });
      return res.data.data;
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("audit.title")}
        description={t("audit.description")}
      />

      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs">{t("audit.filterEntity")}</Label>
          <Input
            className="h-8 w-36 text-xs"
            placeholder="Invoice, User…"
            value={filterEntity}
            onChange={(e) => { setFilterEntity(e.target.value); setOffset(0); }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">{t("audit.filterAction")}</Label>
          <Input
            className="h-8 w-40 text-xs"
            placeholder="INVOICE_VOID…"
            value={filterAction}
            onChange={(e) => { setFilterAction(e.target.value); setOffset(0); }}
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("audit.noRecords")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-start font-medium">{t("audit.colDate")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("audit.colUser")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("audit.colAction")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("audit.colEntity")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("audit.colOld")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("audit.colNew")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {format(new Date(entry.createdAt), "dd/MM/yyyy HH:mm")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{entry.user.name}</div>
                    <div className="text-xs text-muted-foreground">{entry.user.username}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${ACTION_COLORS[entry.action] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{entry.entity}</div>
                    {entry.entityId ? (
                      <div className="truncate max-w-[100px] text-xs text-muted-foreground" title={entry.entityId}>
                        {entry.entityId.slice(0, 10)}…
                      </div>
                    ) : null}
                  </td>
                  <td className="max-w-[180px] px-3 py-2">
                    {entry.oldValue ? (
                      <pre className="truncate whitespace-pre-wrap break-all text-xs text-muted-foreground">
                        {entry.oldValue}
                      </pre>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-[180px] px-3 py-2">
                    {entry.newValue ? (
                      <pre className="truncate whitespace-pre-wrap break-all text-xs">
                        {entry.newValue}
                      </pre>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {t("audit.totalRecords", { total, from: offset + 1, to: Math.min(offset + limit, total) })}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
          >
            {t("audit.prev")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + limit >= total}
            onClick={() => setOffset((o) => o + limit)}
          >
            {t("audit.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
