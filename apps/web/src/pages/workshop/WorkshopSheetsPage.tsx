import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, FileText, Loader2, NotebookPen } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatAED } from "@/lib/money";
import { cn } from "@/lib/utils";
import { dateInputToIso, shrinkPhoto, type SheetKind, type SheetRecord } from "@/lib/workshopSheets";

/**
 * «قراءة ورقة الورشة» — choose the kind of sheet, photograph it, Claude reads it,
 * then the review screen. Below: every sheet read so far (the owner checks here
 * whether a sheet was already entered).
 */
export function WorkshopSheetsPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<SheetKind>("WORK");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [day, setDay] = useState("");

  const history = useQuery({
    queryKey: ["workshop-sheets"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: SheetRecord[] }>("/workshop-sheets");
      return res.data.data;
    },
  });

  const read = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("صوّر الورقة أولًا");
      const photo = await shrinkPhoto(file);
      const form = new FormData();
      form.append("kind", kind);
      if (day) form.append("sheetDate", dateInputToIso(day));
      form.append("image", photo, "sheet.jpg");
      const res = await api.post<{
        success: boolean;
        data: { sheet: { id: string }; samePhoto: { status: string; approvedAt: string | null } | null };
      }>("/workshop-sheets/read", form, {
        timeout: 300_000,
        // The client defaults to JSON; axios fills in the multipart boundary.
        headers: { "Content-Type": "multipart/form-data" },
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      navigate(`/workshop/sheets/${data.sheet.id}`, { state: { samePhoto: data.samePhoto } });
    },
  });

  const pick = (f: File | null) => {
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
    read.reset();
  };

  const kindButton = (k: SheetKind, label: string, Icon: typeof FileText) => (
    <button
      type="button"
      onClick={() => setKind(k)}
      className={cn(
        "flex flex-1 flex-col items-center gap-1 rounded-lg border p-3 text-sm transition",
        kind === k ? "border-primary bg-primary/5 font-semibold text-primary" : "border-border text-muted-foreground",
      )}
      aria-pressed={kind === k}
    >
      <Icon className="h-5 w-5" aria-hidden />
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="قراءة ورقة الورشة"
        description="صوّر الورقة، يقرأها Claude، وتراجعها أنت قبل الحفظ. لا شيء يُحفظ قبل «اعتماد»."
      />

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex gap-2">
          {kindButton("WORK", "ورقة شغل", FileText)}
          {kindButton("ALTERATION", "دفتر تعديل (Ahsan)", NotebookPen)}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-4 text-sm text-muted-foreground hover:bg-muted/40"
        >
          {preview ? (
            <img src={preview} alt="صورة الورقة" className="max-h-72 rounded object-contain" />
          ) : (
            <>
              <Camera className="h-7 w-7" aria-hidden />
              <span>صوّر الورقة أو اختر صورة موجودة</span>
            </>
          )}
        </button>
        {preview ? (
          <button type="button" className="text-xs text-primary underline" onClick={() => fileRef.current?.click()}>
            تغيير الصورة
          </button>
        ) : null}

        {kind === "WORK" ? (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">تاريخ الورقة (اختياري — يُقرأ من الورقة):</span>
            <Input type="date" className="h-9 w-44" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">في دفتر التعديل يُؤخذ التاريخ من عنوان كل يوم في الدفتر.</p>
        )}

        <Button type="button" className="w-full sm:w-auto" disabled={!file || read.isPending} onClick={() => read.mutate()}>
          {read.isPending ? (
            <>
              <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
              Claude يقرأ الورقة… قد يأخذ دقيقة
            </>
          ) : (
            "اقرأ الورقة"
          )}
        </Button>
        {read.isError ? (
          <p className="text-sm font-medium text-destructive">{getApiErrorMessage(read.error, "تعذّرت القراءة")}</p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">الأوراق السابقة</h2>
        {history.isLoading ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : !history.data?.length ? (
          <p className="text-sm text-muted-foreground">لا توجد أوراق بعد.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {history.data.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/workshop/sheets/${s.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm hover:bg-muted/40"
                >
                  <span className="font-medium">{s.kind === "ALTERATION" ? "دفتر تعديل" : "ورقة شغل"}</span>
                  <span className="font-mono text-xs">{new Date(s.sheetDate).toLocaleDateString()}</span>
                  {s.status === "APPROVED" ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                      معتمدة
                    </span>
                  ) : (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                      لم تُعتمد
                    </span>
                  )}
                  {s.status === "APPROVED" ? (
                    <span className="font-mono text-xs tabular-nums">{formatAED(s.totalFils)}</span>
                  ) : null}
                  <span className="ms-auto text-xs text-muted-foreground">
                    {s.approvedBy?.name ?? s.createdBy?.name ?? ""} · {new Date(s.approvedAt ?? s.createdAt).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
