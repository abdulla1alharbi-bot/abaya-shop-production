import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, MessageCircle, PackageCheck, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatAED } from "@/lib/money";
import {
  buildWhatsAppLink,
  orderReadyMessage,
  paymentReminderMessage,
} from "@/lib/whatsappLinks";
import { cn } from "@/lib/utils";

type QueueRow = {
  invoiceId: string;
  invoiceNo: number;
  customer: { id: string; name: string; mobile: string; whatsapp: string | null };
  totalFils: number;
  balanceFils: number;
  pieceCount: number;
  since: string | null;
  daysWaiting: number;
  noticeCount: number;
  lastNoticeAt: string | null;
  lastNoticeBy: string | null;
};

type QueueGroup = { rows: QueueRow[]; total: number; valueFils: number; truncated: boolean };

type MessageQueue = {
  reminderDays: number;
  /** Signed onto each message; sent by the API because sellers can't read /settings. */
  shopName: string | null;
  ready: QueueGroup;
  balance: QueueGroup;
};

type GroupKey = "ready" | "balance";

/** Options offered for "don't show someone I already contacted within…". */
const REMINDER_DAY_CHOICES = [1, 2, 3, 7] as const;

/** Waiting this long turns the row red — a finished abaya nobody collected. */
const URGENT_DAYS = 7;
const WARN_DAYS = 3;

function waitingTone(days: number): string {
  if (days >= URGENT_DAYS) return "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200";
  if (days >= WARN_DAYS)
    return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100";
  return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300";
}

export function CustomerMessagesPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [group, setGroup] = useState<GroupKey>("ready");
  const [reminderDays, setReminderDays] = useState<number>(2);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["customer-message-queue", reminderDays],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: MessageQueue }>(
        "/invoices/message-queue",
        { params: { days: reminderDays } },
      );
      return res.data.data;
    },
  });

  /**
   * Logging is what removes the row from the list, so it must happen for a phone call
   * exactly as it does for WhatsApp — otherwise the same customer resurfaces tomorrow.
   */
  const logContact = useMutation({
    mutationFn: async ({ invoiceId, kind }: { invoiceId: string; kind: "READY" | "BALANCE" }) => {
      await api.post(`/invoices/${invoiceId}/customer-notice`, { kind });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-message-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["nav-badges"] });
    },
  });

  const active: QueueGroup | undefined = data?.[group];
  const rows = active?.rows ?? [];

  function messageFor(row: QueueRow): string {
    const isReminder = row.noticeCount > 0;
    const shopName = data?.shopName ?? undefined;
    if (group === "ready") {
      return orderReadyMessage(row.invoiceNo, row.pieceCount, {
        ...(shopName ? { shopName } : {}),
        ...(row.balanceFils > 0 ? { balanceAed: formatAED(row.balanceFils) } : {}),
        daysWaiting: row.daysWaiting,
        isReminder,
      });
    }
    return paymentReminderMessage(row.invoiceNo, formatAED(row.balanceFils), {
      ...(shopName ? { shopName } : {}),
      isReminder,
    });
  }

  const kind = group === "ready" ? "READY" : "BALANCE";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pages.customerMessages.title")}
        description={t("pages.customerMessages.desc")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="reminder-days">
              {t("pages.customerMessages.quietWindow")}
            </label>
            <select
              id="reminder-days"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={reminderDays}
              onChange={(e) => setReminderDays(Number(e.target.value))}
            >
              {REMINDER_DAY_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {t("pages.customerMessages.quietWindowDays", { count: d })}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={group === "ready" ? "default" : "outline"}
          onClick={() => setGroup("ready")}
        >
          <PackageCheck className="me-2 h-4 w-4" />
          {t("pages.customerMessages.tabReady")}
          {data ? <span className="ms-2 tabular-nums opacity-80">({data.ready.total})</span> : null}
        </Button>
        <Button
          type="button"
          variant={group === "balance" ? "default" : "outline"}
          onClick={() => setGroup("balance")}
        >
          <Wallet className="me-2 h-4 w-4" />
          {t("pages.customerMessages.tabBalance")}
          {data ? <span className="ms-2 tabular-nums opacity-80">({data.balance.total})</span> : null}
        </Button>
      </div>

      {data && active ? (
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground">
              {t("pages.customerMessages.summaryCount")}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{active.total}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground">
              {group === "ready"
                ? t("pages.customerMessages.summaryReadyValue")
                : t("pages.customerMessages.summaryBalanceValue")}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatAED(active.valueFils)}</p>
          </div>
        </section>
      ) : null}

      {logContact.isError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {getApiErrorMessage(logContact.error, t("common.error"))}
        </p>
      ) : null}

      {isLoading ? <p className="text-muted-foreground">{t("common.loading")}</p> : null}
      {isError ? (
        <p className="text-destructive">{getApiErrorMessage(error, t("common.error"))}</p>
      ) : null}

      {!isLoading && !isError && rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <CheckCheck className="mx-auto h-10 w-10 text-emerald-600" />
          <p className="mt-3 font-medium">{t("pages.customerMessages.allDone")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {group === "ready"
              ? t("pages.customerMessages.allDoneReady")
              : t("pages.customerMessages.allDoneBalance")}
          </p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className={cn("space-y-2", isFetching && "opacity-60")}>
          {rows.map((row) => {
            const pending =
              logContact.isPending && logContact.variables?.invoiceId === row.invoiceId;
            return (
              <article
                key={row.invoiceId}
                className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/invoices/${row.invoiceId}`}
                      className="font-semibold hover:underline"
                    >
                      #{row.invoiceNo}
                    </Link>
                    <span className="truncate font-medium">{row.customer.name}</span>
                    <span className="text-sm text-muted-foreground" dir="ltr">
                      {row.customer.mobile}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className={cn("rounded-lg border px-2 py-1 font-medium", waitingTone(row.daysWaiting))}>
                      {group === "ready"
                        ? t("pages.customerMessages.waitingDays", { count: row.daysWaiting })
                        : t("pages.customerMessages.dueDays", { count: row.daysWaiting })}
                    </span>
                    {row.balanceFils > 0 ? (
                      <span className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 font-medium tabular-nums text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                        {t("pages.customerMessages.balanceChip", {
                          amount: formatAED(row.balanceFils),
                        })}
                      </span>
                    ) : null}
                    {group === "ready" && row.pieceCount > 0 ? (
                      <span className="text-muted-foreground">
                        {t("pages.customerMessages.pieces", { count: row.pieceCount })}
                      </span>
                    ) : null}
                    {row.noticeCount > 0 ? (
                      <span className="text-muted-foreground">
                        {t("pages.customerMessages.contactedBefore", {
                          count: row.noticeCount,
                          date: row.lastNoticeAt
                            ? new Date(row.lastNoticeAt).toLocaleDateString(i18n.language)
                            : "—",
                          by: row.lastNoticeBy ?? "—",
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button asChild className="min-w-[150px]">
                    {/*
                      Opening WhatsApp and logging the contact are one action: the log is
                      the only thing that takes the row off tomorrow's list.
                    */}
                    <a
                      href={buildWhatsAppLink(
                        row.customer.whatsapp || row.customer.mobile,
                        messageFor(row),
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => logContact.mutate({ invoiceId: row.invoiceId, kind })}
                    >
                      <MessageCircle className="me-2 h-4 w-4" />
                      {t("pages.customerMessages.sendWhatsApp")}
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => logContact.mutate({ invoiceId: row.invoiceId, kind })}
                  >
                    <CheckCheck className="me-2 h-4 w-4" />
                    {t("pages.customerMessages.logCalled")}
                  </Button>
                </div>
              </article>
            );
          })}
          {active?.truncated ? (
            <p className="pt-2 text-center text-sm text-muted-foreground">
              {t("pages.customerMessages.truncated", {
                shown: rows.length,
                total: active.total,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
