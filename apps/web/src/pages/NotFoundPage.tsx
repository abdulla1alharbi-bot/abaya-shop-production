import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="text-7xl font-bold text-muted-foreground/30">404</p>
      <h1 className="text-2xl font-semibold">الصفحة غير موجودة</h1>
      <p className="text-muted-foreground">الرابط الذي فتحته غير صحيح أو تم حذف الصفحة.</p>
      <Link
        to="/dashboard"
        className="mt-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        العودة للرئيسية
      </Link>
    </div>
  );
}
