"use client";

import { useEffect, useState } from "react";

/**
 * Minimal UI localization scaffold (docs/29 §multilingual UI): English, Sinhala, Tamil.
 * Deliberately small — a dictionary + a hook, no library — covering the launchpad's
 * capability tiles first; other surfaces adopt `t()` incrementally instead of a big-bang
 * retrofit. AI conversation language is NOT controlled here: the assistant detects and
 * mirrors the user's language automatically per message (see GeneralAgent.LanguageInstructions).
 */
export type UiLang = "en" | "si" | "ta";

export const UI_LANG_KEY = "asc_ui_lang";

const EN = {
  intelligence: "Intelligence",
    workspaceTools: "Workspace & tools",
    assistantTitle: "AI Assistant",
    assistantTagline: "Ask anything about tea, auctions, reports or business.",
    askPlaceholder: "Ask anything…",
    askAction: "Ask ASC",
    recentConversations: (n: number) => (n === 0 ? "Start your first conversation" : n === 1 ? "1 recent conversation" : `${n} recent conversations`),
    analyticsTitle: "Analytics & Insights",
    analyticsTagline: "Understand what the data is telling you.",
    analyticsAction: "Explore Insights",
    analyticsQuiet: "No unusual changes right now",
    reportsTitle: "Reports",
    reportsTagline: "Read, understand and create reports.",
    reportsAction: "View Reports",
    reportsEmpty: "No saved reports yet",
    forecastTitle: "Forecasting",
    forecastTagline: "See what may happen next.",
    forecastAction: "View Forecast",
    forecastLoading: "Preparing outlook…",
    forecastUnavailable: "Run your first forecast",
    outlookRising: "Next weeks: prices trending up",
    outlookFalling: "Next weeks: prices trending down",
    outlookFlat: "Next weeks: prices steady",
    marketTitle: "Market & Auction",
  marketTagline: "Understand the market and today's auction.",
  marketAction: "Explore Market",
  marketEmpty: "No sale loaded yet",
};

export type UiStrings = typeof EN;

const DICT: Record<UiLang, UiStrings> = {
  en: EN,
  si: {
    intelligence: "බුද්ධි මධ්‍යස්ථානය",
    workspaceTools: "වැඩපොළ සහ මෙවලම්",
    assistantTitle: "AI සහායක",
    assistantTagline: "තේ, වෙන්දේසි, වාර්තා හෝ ව්‍යාපාරය ගැන ඕනෑම දෙයක් අහන්න.",
    askPlaceholder: "ඕනෑම දෙයක් අහන්න…",
    askAction: "ASC ගෙන් අහන්න",
    recentConversations: (n: number) => (n === 0 ? "පළමු සංවාදය අරඹන්න" : `මෑත සංවාද ${n}`),
    analyticsTitle: "විශ්ලේෂණ සහ අවබෝධ",
    analyticsTagline: "දත්ත ඔබට කියන දේ තේරුම් ගන්න.",
    analyticsAction: "විශ්ලේෂණ බලන්න",
    analyticsQuiet: "දැනට අසාමාන්‍ය වෙනසක් නැත",
    reportsTitle: "වාර්තා",
    reportsTagline: "වාර්තා කියවන්න, තේරුම් ගන්න, සාදන්න.",
    reportsAction: "වාර්තා බලන්න",
    reportsEmpty: "තවම සුරැකි වාර්තා නැත",
    forecastTitle: "අනාවැකි",
    forecastTagline: "ඉදිරියට සිදුවිය හැකි දේ බලන්න.",
    forecastAction: "අනාවැකිය බලන්න",
    forecastLoading: "ඉදිරි දැක්ම සැකසෙමින්…",
    forecastUnavailable: "පළමු අනාවැකිය ලබා ගන්න",
    outlookRising: "ඉදිරි සති: මිල ඉහළට",
    outlookFalling: "ඉදිරි සති: මිල පහළට",
    outlookFlat: "ඉදිරි සති: මිල ස්ථාවරයි",
    marketTitle: "වෙළඳපොළ සහ වෙන්දේසි",
    marketTagline: "වෙළඳපොළ සහ අද වෙන්දේසිය තේරුම් ගන්න.",
    marketAction: "වෙළඳපොළ බලන්න",
    marketEmpty: "තවම විකිණීමක් පූරණය කර නැත",
  },
  ta: {
    intelligence: "நுண்ணறிவு மையம்",
    workspaceTools: "பணியிடம் & கருவிகள்",
    assistantTitle: "AI உதவியாளர்",
    assistantTagline: "தேயிலை, ஏலம், அறிக்கைகள் அல்லது வணிகம் பற்றி எதையும் கேளுங்கள்.",
    askPlaceholder: "எதையும் கேளுங்கள்…",
    askAction: "ASC-யிடம் கேளுங்கள்",
    recentConversations: (n: number) => (n === 0 ? "முதல் உரையாடலைத் தொடங்குங்கள்" : `சமீபத்திய உரையாடல்கள் ${n}`),
    analyticsTitle: "பகுப்பாய்வு & நுண்ணறிவு",
    analyticsTagline: "தரவு சொல்வதைப் புரிந்து கொள்ளுங்கள்.",
    analyticsAction: "நுண்ணறிவுகளைப் பார்க்க",
    analyticsQuiet: "தற்போது அசாதாரண மாற்றம் இல்லை",
    reportsTitle: "அறிக்கைகள்",
    reportsTagline: "அறிக்கைகளைப் படியுங்கள், புரிந்து கொள்ளுங்கள், உருவாக்குங்கள்.",
    reportsAction: "அறிக்கைகளைப் பார்க்க",
    reportsEmpty: "சேமித்த அறிக்கைகள் இன்னும் இல்லை",
    forecastTitle: "முன்னறிவிப்பு",
    forecastTagline: "அடுத்து என்ன நடக்கலாம் என்று பாருங்கள்.",
    forecastAction: "முன்னறிவிப்பைப் பார்க்க",
    forecastLoading: "கணிப்பு தயாராகிறது…",
    forecastUnavailable: "முதல் முன்னறிவிப்பை இயக்குங்கள்",
    outlookRising: "வரும் வாரங்கள்: விலை உயர்வு நோக்கி",
    outlookFalling: "வரும் வாரங்கள்: விலை சரிவு நோக்கி",
    outlookFlat: "வரும் வாரங்கள்: விலை நிலையானது",
    marketTitle: "சந்தை & ஏலம்",
    marketTagline: "சந்தையையும் இன்றைய ஏலத்தையும் புரிந்து கொள்ளுங்கள்.",
    marketAction: "சந்தையைப் பார்க்க",
    marketEmpty: "விற்பனை இன்னும் ஏற்றப்படவில்லை",
  },
};

export function getUiLang(): UiLang {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(UI_LANG_KEY);
  return stored === "si" || stored === "ta" ? stored : "en";
}

/** Current UI language + its strings. `setLang` persists and re-renders — intended for the
 *  one selector in Settings, not for scattering language pickers across the app. */
export function useUiLang(): { lang: UiLang; t: UiStrings; setLang: (l: UiLang) => void } {
  const [lang, setLangState] = useState<UiLang>("en");
  // Hydration-safe: first render is always English (matching the server), the stored
  // preference applies right after mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLangState(getUiLang());
  }, []);
  const setLang = (l: UiLang) => {
    window.localStorage.setItem(UI_LANG_KEY, l);
    setLangState(l);
  };
  return { lang, t: DICT[lang], setLang };
}
