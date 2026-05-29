import { create } from "zustand";
import i18n from "@/i18n/index";

type Lang = "ar" | "en";

interface LangState {
  lang: Lang;
  isRTL: boolean;
  setLang: (lang: Lang) => void;
}

function applyHtmlAttributes(lang: Lang) {
  document.documentElement.setAttribute("lang", lang);
  document.documentElement.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  localStorage.setItem("lang", lang);
  void i18n.changeLanguage(lang);
}

const initialLang = (localStorage.getItem("lang") as Lang) ?? "ar";
applyHtmlAttributes(initialLang);

export const useLangStore = create<LangState>((set) => ({
  lang: initialLang,
  isRTL: initialLang === "ar",
  setLang: (lang) => {
    applyHtmlAttributes(lang);
    set({ lang, isRTL: lang === "ar" });
  },
}));
