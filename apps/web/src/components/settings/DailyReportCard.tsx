import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { usePermissions } from "@/hooks/usePermissions";

type DailyReportConfig = {
  enabled: boolean;
  time: string;
  recipients: string[];
  timeZone: string;
  lastSentDateKey: string | null;
  smtp: { configured: boolean; host: string | null; port: number; secure: boolean; from: string | null };
};

/**
 * End-of-day report settings: whether it goes out, when, and to whom.
 *
 * The SMTP credentials are NOT editable here — they live in the server's env, so a
 * missing setup shows as a warning with what the admin has to add, rather than a
 * password box on a screen half the staff can open.
 */
export function DailyReportCard() {
  const { i18n } = useTranslation();
  const isEn = i18n.language === "en";

  const { data, isLoading } = useQuery({
    queryKey: ["daily-report-config"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: DailyReportConfig }>("/reports/daily-report/config");
      return res.data.data;
    },
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm font-medium">{isEn ? "Daily email report" : "التقرير اليومي بالبريد"}</p>
        <p className="mt-2 text-sm text-muted-foreground">…</p>
      </div>
    );
  }

  // Keyed on the saved values so the fields re-seed from the server after a save —
  // that is how the owner sees the normalised time and cleaned address list.
  return <DailyReportForm key={`${data.enabled}|${data.time}|${data.recipients.join(",")}`} data={data} />;
}

function DailyReportForm({ data }: { data: DailyReportConfig }) {
  const { can } = usePermissions();
  const { i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const queryClient = useQueryClient();
  const editable = can("settings.manage");

  const [enabled, setEnabled] = useState(data.enabled);
  const [time, setTime] = useState(data.time);
  const [recipients, setRecipients] = useState(data.recipients.join(", "));
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      await api.patch("/reports/daily-report/config", { enabled, time, recipients });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["daily-report-config"] });
    },
  });

  const sendNow = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: { recipients: string[] } }>(
        "/reports/daily-report/send",
        {},
      );
      return res.data.data;
    },
  });

  const preview = useMutation({
    mutationFn: async () => {
      const res = await api.get<{ success: boolean; data: { html: string } }>("/reports/daily-report/preview");
      return res.data.data.html;
    },
    onSuccess: (html) => setPreviewHtml(html),
  });

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{isEn ? "Daily email report" : "التقرير اليومي بالبريد"}</p>
        <Badge variant={data.enabled ? "default" : "secondary"}>
          {data.enabled ? (isEn ? "On" : "مُفعّل") : isEn ? "Off" : "متوقف"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {isEn
          ? "A summary of the day — tailoring sold, money collected, workshop wages and expenses — emailed automatically after closing."
          : "ملخّص اليوم — قيمة التفصيل، المقبوض من الزبائن، أجور الورشة والمصروفات — يصلك تلقائياً بعد إغلاق المحل."}
      </p>

      {!data.smtp.configured ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-6 text-amber-900">
          <p className="font-medium">
            {isEn ? "Email is not set up on the server yet" : "خادم البريد غير مُهيّأ على السيرفر بعد"}
          </p>
          <p>
            {isEn
              ? "Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM to the server's .env and restart the api container. Until then nothing will be sent."
              : "أضف SMTP_HOST و SMTP_PORT و SMTP_USER و SMTP_PASS و SMTP_FROM في ملف .env على السيرفر ثم أعد تشغيل حاوية api. قبل ذلك لن يُرسَل أي بريد."}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          {isEn ? "Sends from" : "يُرسَل من"} <span dir="ltr" className="font-mono">{data.smtp.from}</span>
          {" · "}
          <span dir="ltr" className="font-mono">{data.smtp.host}:{data.smtp.port}</span>
        </p>
      )}

      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!editable) return;
          save.mutate();
        }}
      >
        <fieldset disabled={!editable} className="space-y-4 border-0 p-0 disabled:opacity-60">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {isEn ? "Send the report every day" : "أرسل التقرير كل يوم"}
          </label>

          <div className="grid gap-2 sm:max-w-[200px]">
            <Label htmlFor="daily_report_time">
              {isEn ? "Send at (shop time)" : "وقت الإرسال (بتوقيت المحل)"}
            </Label>
            <Input
              id="daily_report_time"
              type="time"
              dir="ltr"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {isEn ? `Timezone: ${data.timeZone}` : `المنطقة الزمنية: ${data.timeZone}`}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="daily_report_emails">
              {isEn ? "Send to (comma separated)" : "يُرسَل إلى (افصل بينها بفاصلة)"}
            </Label>
            <Input
              id="daily_report_emails"
              dir="ltr"
              placeholder="owner@example.com, manager@example.com"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? "…" : isEn ? "Save" : "حفظ"}
            </Button>
            {can("reports.financial") ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={preview.isPending}
                onClick={() => preview.mutate()}
              >
                {preview.isPending ? "…" : isEn ? "Preview today's report" : "معاينة تقرير اليوم"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sendNow.isPending || !data.smtp.configured || data.recipients.length === 0}
              onClick={() => sendNow.mutate()}
            >
              {sendNow.isPending ? "…" : isEn ? "Send one now" : "أرسل نسخة الآن"}
            </Button>
          </div>
        </fieldset>
      </form>

      <div className="mt-3 space-y-1 text-xs">
        {save.isSuccess ? (
          <p className="text-green-700">{isEn ? "Saved" : "تم الحفظ"}</p>
        ) : null}
        {save.isError ? <p className="text-destructive">{getApiErrorMessage(save.error)}</p> : null}
        {sendNow.isSuccess ? (
          <p className="text-green-700" dir="ltr">
            {isEn ? "Sent to " : "أُرسل إلى "}
            {sendNow.data?.recipients.join(", ")}
          </p>
        ) : null}
        {sendNow.isError ? <p className="text-destructive">{getApiErrorMessage(sendNow.error)}</p> : null}
        {preview.isError ? <p className="text-destructive">{getApiErrorMessage(preview.error)}</p> : null}
        {data.lastSentDateKey ? (
          <p className="text-muted-foreground">
            {isEn ? "Last automatic send: " : "آخر إرسال تلقائي: "}
            <span dir="ltr">{data.lastSentDateKey}</span>
          </p>
        ) : (
          <p className="text-muted-foreground">
            {isEn ? "No automatic report has gone out yet." : "لم يُرسَل أي تقرير تلقائي بعد."}
          </p>
        )}
      </div>

      <Dialog open={previewHtml !== null} onOpenChange={(open) => !open && setPreviewHtml(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{isEn ? "Today's report" : "تقرير اليوم"}</DialogTitle>
          </DialogHeader>
          {/* Sandboxed: the preview is server-rendered HTML and must not run anything. */}
          <iframe
            title={isEn ? "Daily report preview" : "معاينة التقرير اليومي"}
            sandbox=""
            srcDoc={previewHtml ?? ""}
            className="h-[70vh] w-full rounded-md border bg-white"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
