import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { arSA } from "date-fns/locale/ar-SA";
import { enUS } from "date-fns/locale/en-US";
import { useTranslation } from "react-i18next";
import { useServerNotificationStore } from "@/store/serverNotificationStore";
import { useLangStore } from "@/store/langStore";
import { Button } from "@/components/ui/button";

export function NotificationBell() {
  const { unreadCount, items, fetch, markRead, markAllRead } = useServerNotificationStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { lang } = useLangStore();
  const dateLocale = lang === "ar" ? arSA : enUS;

  useEffect(() => {
    void fetch();
  }, [fetch]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("topbar.notifications")}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-white"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute end-0 top-full z-50 mt-2 w-80 rounded-xl border border-border bg-popover shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-semibold">{t("topbar.notifications")}</span>
            {unreadCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => void markAllRead()}
              >
                {t("topbar.markAllRead")}
              </Button>
            ) : null}
          </div>

          <ul className="max-h-[360px] overflow-y-auto divide-y divide-border">
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">{t("topbar.noNotifications")}</li>
            ) : (
              items.map((n) => (
                <li
                  key={n.id}
                  className={`cursor-pointer px-4 py-3 text-sm hover:bg-muted/40 ${!n.isRead ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}`}
                  onClick={() => {
                    void markRead(n.id);
                    setOpen(false);
                    if (n.link) navigate(n.link);
                  }}
                >
                  <p className="font-medium leading-snug">{n.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{n.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: dateLocale })}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
