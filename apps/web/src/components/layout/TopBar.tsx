import { Languages, Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuthStore } from "@/store/authStore";
import { useLogout } from "@/hooks/useAuth";
import { useLangStore } from "@/store/langStore";
import { NotificationBell } from "./NotificationBell";

interface TopBarProps {
  title: string;
  onOpenMobileNav?: () => void;
}

export function TopBar({ title, onOpenMobileNav }: TopBarProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const { lang, setLang } = useLangStore();
  const { t } = useTranslation();
  const initials = user?.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-3 shadow-sm md:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          onClick={onOpenMobileNav}
          aria-label={t("topbar.openMenu")}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="truncate text-base font-semibold md:text-lg">{title}</h1>
      </div>
      <div className="flex items-center gap-1">
        <NotificationBell />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full"
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          title={lang === "ar" ? "English" : "عربي"}
          aria-label={t("topbar.switchLanguage")}
        >
          <Languages className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 rounded-full p-0">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">{initials ?? "?"}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.name}</p>
                <p className="text-xs leading-none text-muted-foreground" dir="ltr">
                  {user?.username}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void logout()}>{t("topbar.logout")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
