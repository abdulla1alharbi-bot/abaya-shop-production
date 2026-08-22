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

type SmtpSummary = {
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  from: string | null;
  hasPassword: boolean;
  source: "settings" | "env" | "none";
};

type DailyReportConfig = {
  enabled: boolean;
  time: string;
  recipients: string[];
  timeZone: string;
  lastSentDateKey: string | null;
  smtp: SmtpSummary;
};

/**
 * End-of-day report settings, including the mail server itself.
 *
 * The SMTP password is write-only: the server never sends it back, so the field
 * starts empty and an empty field means "leave it alone". That keeps an ordinary
 * save (changing the time, say) from wiping the stored password.
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
  const key = `${data.enabled}|${data.time}|${data.recipients.join(",")}|${data.smtp.host}|${data.smtp.port}|${data.smtp.secure}|${data.smtp.user}|${data.smtp.from}|${data.smtp.hasPassword}`;
  return <DailyReportForm key={key} data={data} />;
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

  const [smtpHost, setSmtpHost] = useState(data.smtp.host ?? "");
  const [smtpPort, setSmtpPort] = useState(data.smtp.host ? String(data.smtp.port) : "");
  const [smtpSecure, setSmtpSecure] = useState(data.smtp.secure);
  const [smtpUser, setSmtpUser] = useState(data.smtp.user ?? "");
  const [smtpFrom, setSmtpFrom] = useState(data.smtp.from ?? "");
  const [smtpPass, setSmtpPass] = useState("");

  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      await api.patch("/reports/daily-report/config", {
        enabled,
        time,
        recipients,
        smtpHost,
        smtpPort,
        smtpSecure,
        smtpUser,
        smtpFrom,
        // Omitted when blank so a routine save never clears the stored password.
        ...(smtpPass.trim() ? { smtpPass } : {}),
      });
    },
    onSuccess: () => {
      setSmtpPass("");
      void queryClient.invalidateQueries({ queryKey: ["daily-report-config"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const verify = useMutation({
    mutationFn: async () => {
      await api.post("/reports/daily-report/verify-smtp", {});
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

  /** One tap fills every Gmail-specific value; only the App Password is left to type. */
  const applyGmailPreset = () => {
    const address = smtpUser.trim() || recipients.split(",")[0]?.trim() || "";
    setSmtpHost("smtp.gmail.com");
    setSmtpPort("587");
    setSmtpSecure(false);
    if (address) {
      setSmtpUser(address);
      if (!smtpFrom.trim()) setSmtpFrom(address);
    }
  };

  const busy = save.isPending || verify.isPending || sendNow.isPending;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{isEn ? "Daily email report" : "التقرير اليومي بالبريد"}</p>
        <Badge variant={data.enabled && data.smtp.configured ? "default" : "secondary"}>
          {!data.smtp.configured
            ? isEn
              ? "Not set up"
              : "غير مكتمل"
            : data.enabled
              ? isEn
                ? "On"
                : "مُفعّل"
              : isEn
                ? "Off"
                : "متوقف"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {isEn
          ? "A summary of the day — tailoring sold, money collected, workshop wages and expenses — emailed automatically after closing."
          : "ملخّص اليوم — قيمة التفصيل، المقبوض من الزبائن، أجور الورشة والمصروفات — يصلك تلقائياً بعد إغلاق المحل."}
      </p>

      <form
        className="mt-4 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!editable) return;
          save.mutate();
        }}
      >
        <fieldset disabled={!editable} className="space-y-5 border-0 p-0 disabled:opacity-60">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {isEn ? "Send the report every day" : "أرسل التقرير كل يوم"}
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
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
                inputMode="email"
                placeholder="owner@example.com"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{isEn ? "Mail server" : "خادم البريد"}</p>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={applyGmailPreset}>
                {isEn ? "Use Gmail settings" : "استخدم إعدادات Gmail"}
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isEn
                ? "For Gmail: tap the button above, then paste a Google App Password below — not your account password."
                : "لـ Gmail: اضغط الزر أعلاه، ثم الصق كلمة مرور تطبيق من Google أدناه — وليست كلمة مرور حسابك."}
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="smtp_host">{isEn ? "Server" : "الخادم"}</Label>
                <Input
                  id="smtp_host"
                  dir="ltr"
                  placeholder="smtp.gmail.com"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="smtp_port">{isEn ? "Port" : "المنفذ"}</Label>
                <Input
                  id="smtp_port"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="587"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="smtp_user">{isEn ? "Username" : "اسم المستخدم"}</Label>
                <Input
                  id="smtp_user"
                  dir="ltr"
                  inputMode="email"
                  autoComplete="off"
                  placeholder="you@gmail.com"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="smtp_pass">
                  {isEn ? "App password" : "كلمة مرور التطبيق"}
                  {data.smtp.hasPassword ? (
                    <span className="ms-2 text-xs font-normal text-green-700">
                      {isEn ? "· saved" : "· محفوظة"}
                    </span>
                  ) : null}
                </Label>
                <Input
                  id="smtp_pass"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  placeholder={
                    data.smtp.hasPassword
                      ? isEn
                        ? "Leave empty to keep it"
                        : "اتركه فارغاً للإبقاء عليها"
                      : isEn
                        ? "16 letters from Google"
                        : "16 حرفاً من Google"
                  }
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="smtp_from">{isEn ? "Sender address" : "عنوان المُرسِل"}</Label>
                <Input
                  id="smtp_from"
                  dir="ltr"
                  placeholder="Pure Diamond <you@gmail.com>"
                  value={smtpFrom}
                  onChange={(e) => setSmtpFrom(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={smtpSecure}
                  onChange={(e) => setSmtpSecure(e.target.checked)}
                />
                {isEn ? "Implicit TLS (port 465). Leave off for 587." : "تشفير مباشر (منفذ 465). اتركه فارغاً مع 587."}
              </label>
            </div>

            {data.smtp.source === "env" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {isEn
                  ? "These values currently come from the server environment; saving here overrides them."
                  : "هذه القيم قادمة حالياً من إعدادات السيرفر؛ الحفظ هنا يتجاوزها."}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {save.isPending ? "…" : isEn ? "Save" : "حفظ"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !data.smtp.configured}
              onClick={() => verify.mutate()}
            >
              {verify.isPending ? "…" : isEn ? "Test connection" : "اختبار الاتصال"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !data.smtp.configured || data.recipients.length === 0}
              onClick={() => sendNow.mutate()}
            >
              {sendNow.isPending ? "…" : isEn ? "Send one now" : "أرسل نسخة الآن"}
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
          </div>
        </fieldset>
      </form>

      <div className="mt-3 space-y-1 text-xs">
        {save.isSuccess ? <p className="text-green-700">{isEn ? "Saved" : "تم الحفظ"}</p> : null}
        {save.isError ? <p className="text-destructive">{getApiErrorMessage(save.error)}</p> : null}
        {verify.isSuccess ? (
          <p className="text-green-700">
            {isEn ? "Connected to the mail server successfully" : "تم الاتصال بخادم البريد بنجاح"}
          </p>
        ) : null}
        {verify.isError ? <p className="text-destructive">{getApiErrorMessage(verify.error)}</p> : null}
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
        {!editable ? (
          <p className="text-muted-foreground">
            {isEn ? "View only — you cannot change these." : "للعرض فقط — لا تملك صلاحية التعديل."}
          </p>
        ) : null}
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
