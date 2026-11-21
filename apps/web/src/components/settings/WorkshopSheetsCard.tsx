import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_SHEET_READER_HINTS } from "@abaya-shop/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { usePermissions } from "@/hooks/usePermissions";

/** The server sends this instead of a stored secret. */
const REDACTED = "__SET__";

/**
 * «قراءة أوراق الورشة» settings. The Anthropic key is write-only: the field
 * starts empty and an empty field means "keep the saved key", so saving the
 * other fields never wipes it.
 */
export function WorkshopSheetsCard() {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, string> }>("/settings");
      return res.data.data;
    },
  });
  if (!data) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm font-medium">قراءة أوراق الورشة</p>
        <p className="mt-2 text-sm text-muted-foreground">…</p>
      </div>
    );
  }
  return <WorkshopSheetsForm settings={data} />;
}

function WorkshopSheetsForm({ settings: data }: { settings: Record<string, string> }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canManage = can("settings.manage");

  const [apiKey, setApiKey] = useState("");
  const [cutter, setCutter] = useState(data.sheet_cutter_name ?? "");
  const [cutterWage, setCutterWage] = useState(
    data.sheet_cutter_wage_fils ? String(Number(data.sheet_cutter_wage_fils) / 100) : "",
  );
  const [altWorker, setAltWorker] = useState(data.sheet_alteration_worker_name ?? "");
  const [hints, setHints] = useState(data.sheet_reader_hints ?? "");

  const hasKey = data.anthropic_api_key === REDACTED;

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {
        sheet_cutter_name: cutter.trim(),
        sheet_alteration_worker_name: altWorker.trim(),
        sheet_reader_hints: hints.trim(),
      };
      const wage = parseFloat(cutterWage);
      body.sheet_cutter_wage_fils = cutterWage.trim() === "" || Number.isNaN(wage) ? "" : String(Math.round(wage * 100));
      if (apiKey.trim()) body.anthropic_api_key = apiKey.trim();
      await api.patch("/settings", body);
    },
    onSuccess: () => {
      setApiKey("");
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const test = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: { model: string } }>("/settings/workshop-sheets/test-key");
      return res.data.data;
    },
  });

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <p className="text-sm font-medium">قراءة أوراق الورشة</p>
        <p className="mt-1 text-xs text-muted-foreground">
          مفتاح حساب Anthropic (غير اشتراك Claude العادي). يُحفظ ولا يظهر بعد الحفظ.
        </p>
      </div>
      <fieldset disabled={!canManage} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="anthropic_api_key">مفتاح Anthropic</Label>
          <Input
            id="anthropic_api_key"
            type="password"
            autoComplete="off"
            placeholder={hasKey ? "محفوظ — اتركه فاضي للإبقاء عليه" : "sk-ant-…"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="sheet_cutter_name">القصاص (تلقائي)</Label>
            <Input id="sheet_cutter_name" placeholder="Mahbob" value={cutter} onChange={(e) => setCutter(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sheet_cutter_wage">أجر القص (درهم)</Label>
            <Input
              id="sheet_cutter_wage"
              inputMode="decimal"
              placeholder="5"
              value={cutterWage}
              onChange={(e) => setCutterWage(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sheet_alteration_worker">عامل دفتر التعديل</Label>
            <Input id="sheet_alteration_worker" placeholder="Ahsan" value={altWorker} onChange={(e) => setAltWorker(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sheet_reader_hints">قواعد القراءة (للمتقدمين)</Label>
          <textarea
            id="sheet_reader_hints"
            className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            dir="ltr"
            placeholder={DEFAULT_SHEET_READER_HINTS}
            value={hints}
            onChange={(e) => setHints(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">اتركها فاضية لاستخدام القواعد المتفق عليها (الظاهرة باللون الخفيف).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "…" : "حفظ"}
          </Button>
          <Button type="button" variant="outline" disabled={test.isPending || (!hasKey && !save.isSuccess)} onClick={() => test.mutate()}>
            {test.isPending ? "…" : "اختبار المفتاح"}
          </Button>
          {save.isSuccess ? <span className="text-sm text-green-700">تم الحفظ</span> : null}
          {save.isError ? <span className="text-sm text-destructive">{getApiErrorMessage(save.error)}</span> : null}
          {test.isSuccess ? <span className="text-sm text-green-700">المفتاح يعمل ({test.data.model})</span> : null}
          {test.isError ? <span className="text-sm text-destructive">{getApiErrorMessage(test.error)}</span> : null}
        </div>
      </fieldset>
    </div>
  );
}
