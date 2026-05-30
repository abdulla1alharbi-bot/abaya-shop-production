import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";

export function FabricRollForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { id: string; name: string }[] }>(
        "/branches",
      );
      return res.data.data;
    },
  });

  const { data: existing, isLoading } = useQuery({
    queryKey: ["fabric-roll", id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/fabric-rolls/${id}`);
      return res.data.data;
    },
    enabled: !isNew && Boolean(id),
  });

  // Sync imageUrl from existing data when loaded
  React.useEffect(() => {
    if (existing) {
      setImageUrl((existing as { imageUrl?: string | null }).imageUrl ?? null);
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const payload = {
        name: String(form.get("name") ?? ""),
        type: String(form.get("type") ?? ""),
        color: String(form.get("color") ?? ""),
        branchId: String(form.get("branchId") ?? "") || undefined,
        totalMeters: parseFloat(String(form.get("totalMeters") ?? "0")),
        costPerMeter: Math.round((parseFloat(String(form.get("costPerMeter"))) || 0) * 100),
        lowStockAt: parseFloat(String(form.get("lowStockAt") ?? "5")),
        isActive: form.has("isActiveFabric"),
        category: String(form.get("category") ?? "FABRIC"),
        imageUrl: imageUrl ?? null,
      };
      if (isNew) {
        await api.post("/fabric-rolls", payload);
      } else {
        await api.patch(`/fabric-rolls/${id}`, payload);
      }
    },
    onSuccess: () => {
      setSaveError(null);
      void queryClient.invalidateQueries({ queryKey: ["fabric-rolls"] });
      void navigate("/fabrics");
    },
    onError: (err: unknown) => {
      setSaveError(getApiErrorMessage(err, "Failed to save. Please try again."));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/fabric-rolls/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["fabric-rolls"] });
      void navigate("/fabrics");
    },
    onError: (err: unknown) => {
      const msg = getApiErrorMessage(err, "حدث خطأ أثناء الحذف.");
      setDeleteError(
        msg.includes("used") || msg.includes("ROLL_IN_USE")
          ? "لا يمكن حذف هذه اللفة لأنها مستخدمة في طلبات أو إنتاج."
          : msg,
      );
    },
  });

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post<{ success: boolean; data: { url: string } }>("/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setImageUrl(res.data.data.url);
    } catch {
      setUploadError("فشل رفع الصورة. تأكد أن الملف صورة وحجمه أقل من 5MB.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!isNew && isLoading) {
    return (
      <div>
        <PageHeader title="Fabric roll" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace("/api", "") ?? "";
  const fullImageUrl = imageUrl
    ? imageUrl.startsWith("http")
      ? imageUrl
      : `${apiBase}${imageUrl}`
    : null;

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader title={isNew ? "New fabric roll" : "Edit fabric roll"} />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSaveError(null);
          save.mutate(new FormData(e.currentTarget));
        }}
      >
        {/* Image upload */}
        <div className="grid gap-2">
          <Label>صورة القماش (اختياري)</Label>
          <div className="flex items-start gap-3">
            {fullImageUrl ? (
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border bg-muted">
                <img src={fullImageUrl} alt="fabric" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImageUrl(null)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
                <Upload className="h-6 w-6" />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? "جاري الرفع…" : fullImageUrl ? "تغيير الصورة" : "رفع صورة"}
              </Button>
              <p className="text-xs text-muted-foreground">JPG, PNG, WEBP — أقصى 5MB</p>
              {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="category">الفئة</Label>
          <select
            id="category"
            name="category"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={existing ? String((existing as { category?: string }).category ?? "FABRIC") : "FABRIC"}
            key={String((existing as { category?: string })?.category ?? "cat")}
          >
            <option value="FABRIC">قماش</option>
            <option value="LACE">دانتيل</option>
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="name">الاسم</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={existing ? String(existing.name ?? "") : ""}
            key={String(existing?.name ?? "n")}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="type">Type</Label>
            <Input
              id="type"
              name="type"
              required
              defaultValue={existing ? String(existing.type ?? "") : ""}
              key={String(existing?.type ?? "t")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="color">Color</Label>
            <Input
              id="color"
              name="color"
              required
              defaultValue={existing ? String(existing.color ?? "") : ""}
              key={String(existing?.color ?? "c")}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="branchId">Branch</Label>
          <select
            id="branchId"
            name="branchId"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={existing ? String((existing as { branchId?: string }).branchId ?? "") : ""}
          >
            <option value="">Default branch</option>
            {branches?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="totalMeters">Total meters</Label>
            <Input
              id="totalMeters"
              name="totalMeters"
              type="number"
              step={0.01}
              min={0.01}
              required
              defaultValue={existing ? String((existing as { totalMeters?: number }).totalMeters ?? "") : ""}
              key={String((existing as { totalMeters?: number })?.totalMeters ?? "tm")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lowStockAt">Low stock at (m)</Label>
            <Input
              id="lowStockAt"
              name="lowStockAt"
              type="number"
              step={0.1}
              min={0}
              defaultValue={existing ? String((existing as { lowStockAt?: number }).lowStockAt ?? 5) : "5"}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="costPerMeter">Cost per meter (AED)</Label>
          <Input
            id="costPerMeter"
            name="costPerMeter"
            type="number"
            step={0.01}
            min={0}
            required
            defaultValue={
              existing
                ? String(((existing as { costPerMeter?: number }).costPerMeter ?? 0) / 100)
                : ""
            }
            key={String((existing as { costPerMeter?: number })?.costPerMeter ?? "cp")}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActiveFabric"
            defaultChecked={existing ? (existing as { isActive?: boolean }).isActive !== false : true}
            className="h-4 w-4 rounded border-input"
          />
          نشط (يظهر في اختيار القماش للتفصيل)
        </label>
        {saveError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {saveError}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link to="/fabrics">Cancel</Link>
            </Button>
          </div>
          {!isNew && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => { setDeleteError(null); setShowDeleteDialog(true); }}
            >
              <Trash2 className="me-1.5 h-4 w-4" />
              حذف
            </Button>
          )}
        </div>
      </form>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف اللفة</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            هل أنت متأكد من حذف هذه اللفة؟ لا يمكن التراجع عن هذا الإجراء.
            <br />
            <span className="text-xs text-amber-600 mt-1 block">
              ملاحظة: لا يمكن حذف لفة تم استخدامها في طلبات أو إنتاج.
            </span>
          </p>
          {deleteError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm">إلغاء</Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "جاري الحذف…" : "نعم، احذف"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
