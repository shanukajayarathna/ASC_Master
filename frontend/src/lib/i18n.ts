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

  // ---- AI Assistant hub (components/agent-hub) ----
  hubBreadcrumbRoot: "ASC Intelligence Hub",
  hubSub: "Ask anything, or pick a specialist for one job.",
  hubStartHere: "Start here",
  hubAgentLabel: (n: number) => `Agent ${String(n).padStart(2, "0")}`,
  hubOpenAgent: (name: string) => `Open the ${name} agent`,
  hubNoSale: "No sale selected",
  hubLangLabel: "Interface language",
  hubAllAgents: "All agents",
  hubOpening: (name: string) => `Opening the ${name} agent…`,
  hubOpenClassic: "Open classic chat",
  agentGeneral: "General",
  agentAuction: "Auction",
  agentAnalytics: "Analytics",
  agentReports: "Reports",
  agentGeneralPurpose: "Ask anything about the platform, the sale or the by-laws.",
  agentGeneralCaps: "Ask anything · Voice chat · CTTA by-laws knowledge base · Sale-aware",
  agentAuctionPurpose: "Look up lots, valuations and prices for the sale.",
  agentAuctionCaps: "Lot lookup · Grade and broker prices · Sale-aware",
  agentAnalyticsPurpose: "Compare brokers, grades and 13 years of trends.",
  agentAnalyticsCaps: "Drill-down charts · Pinned insights · Explain this chart",
  agentReportsPurpose: "Build a report or deck, then export it.",
  agentReportsCaps: "Custom reports · PowerPoint · Excel · PDF · Voice",
  hubAskTitle: "Ask anything",
  hubAskHint: "General answers across the whole platform. Need one specific job done? Choose a specialist below.",
  hubAskPlaceholder: "Ask about a lot, a broker, a sale or a by-law…",
  hubAskLabel: "Your question",
  hubAskSend: "Ask",
  hubSpecialists: "Or choose a specialist for one job",
  hubPrompt1: "Summarise this week's sale",
  hubPrompt2: "Which broker performed best?",
  hubPrompt3: "Explain a CTTA by-law",
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

    // AI Assistant hub — DRAFT translations, pending native-speaker review (docs/assistant-hub-i18n-review.md)
    hubBreadcrumbRoot: "ASC බුද්ධි මධ්‍යස්ථානය",
    hubSub: "ඕනෑම දෙයක් අහන්න, නැතහොත් එක් කාර්යයක් සඳහා විශේෂඥයෙකු තෝරන්න.",
    hubStartHere: "මෙතැනින් අරඹන්න",
    hubAgentLabel: (n: number) => `සහායක ${String(n).padStart(2, "0")}`,
    hubOpenAgent: (name: string) => `${name} සහායකයා විවෘත කරන්න`,
    hubNoSale: "විකිණීමක් තෝරා නැත",
    hubLangLabel: "අතුරුමුහුණත් භාෂාව",
    hubAllAgents: "සියලු සහායකයන්",
    hubOpening: (name: string) => `${name} සහායකයා විවෘත කරමින්…`,
    hubOpenClassic: "සම්භාව්‍ය සංවාදය විවෘත කරන්න",
    agentGeneral: "සාමාන්‍ය",
    agentAuction: "වෙන්දේසි",
    agentAnalytics: "විශ්ලේෂණ",
    agentReports: "වාර්තා",
    agentGeneralPurpose: "වේදිකාව, විකිණීම හෝ අතුරු නීති ගැන ඕනෑම දෙයක් අහන්න.",
    agentGeneralCaps: "ඕනෑම දෙයක් අහන්න · හඬ සංවාදය · CTTA අතුරු නීති දැනුම් පදනම · වෙන්දේසිය දන්නා",
    agentAuctionPurpose: "වෙන්දේසිය සඳහා ලොට්, තක්සේරු සහ මිල සොයන්න.",
    agentAuctionCaps: "ලොට් සෙවීම · ශ්‍රේණි සහ තැරැව්කරු මිල · වෙන්දේසිය දන්නා",
    agentAnalyticsPurpose: "තැරැව්කරුවන්, ශ්‍රේණි සහ වසර 13ක ප්‍රවණතා සසඳන්න.",
    agentAnalyticsCaps: "ගැඹුරට යන ප්‍රස්තාර · ඇමිණූ අවබෝධ · මේ ප්‍රස්තාරය පහදන්න",
    agentReportsPurpose: "වාර්තාවක් හෝ ඉදිරිපත්කිරීමක් සාදා නිර්යාත කරන්න.",
    agentReportsCaps: "අභිරුචි වාර්තා · PowerPoint · Excel · PDF · හඬ",
    hubAskTitle: "ඕනෑම දෙයක් අහන්න",
    hubAskHint: "සාමාන්‍ය සහායකයා මුළු වේදිකාවම ආවරණය කරයි. නිශ්චිත කාර්යයක් සඳහා විශේෂඥයෙකු අවශ්‍යද? පහතින් තෝරන්න.",
    hubAskPlaceholder: "ලොට් එකක්, තැරැව්කරුවෙකු, විකිණීමක් හෝ අතුරු නීතියක් ගැන අහන්න…",
    hubAskLabel: "ඔබේ ප්‍රශ්නය",
    hubAskSend: "අහන්න",
    hubSpecialists: "නැතහොත් එක් කාර්යයක් සඳහා විශේෂඥයෙකු තෝරන්න",
    hubPrompt1: "මෙම සතියේ විකිණීම සාරාංශ කරන්න",
    hubPrompt2: "වඩාත්ම හොඳින් ක්‍රියා කළ තැරැව්කරු කවුද?",
    hubPrompt3: "CTTA අතුරු නීතියක් පහදන්න",
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

    // AI Assistant hub — DRAFT translations, pending native-speaker review (docs/assistant-hub-i18n-review.md)
    hubBreadcrumbRoot: "ASC நுண்ணறிவு மையம்",
    hubSub: "எதையும் கேளுங்கள், அல்லது ஒரு வேலைக்கு நிபுணரைத் தேர்ந்தெடுங்கள்.",
    hubStartHere: "இங்கிருந்து தொடங்குங்கள்",
    hubAgentLabel: (n: number) => `உதவியாளர் ${String(n).padStart(2, "0")}`,
    hubOpenAgent: (name: string) => `${name} உதவியாளரைத் திறக்கவும்`,
    hubNoSale: "விற்பனை தேர்ந்தெடுக்கப்படவில்லை",
    hubLangLabel: "இடைமுக மொழி",
    hubAllAgents: "அனைத்து உதவியாளர்கள்",
    hubOpening: (name: string) => `${name} உதவியாளரைத் திறக்கிறது…`,
    hubOpenClassic: "கிளாசிக் அரட்டையைத் திறக்கவும்",
    agentGeneral: "பொது",
    agentAuction: "ஏலம்",
    agentAnalytics: "பகுப்பாய்வு",
    agentReports: "அறிக்கைகள்",
    agentGeneralPurpose: "தளம், விற்பனை அல்லது துணைவிதிகள் பற்றி எதையும் கேளுங்கள்.",
    agentGeneralCaps: "எதையும் கேளுங்கள் · குரல் உரையாடல் · CTTA துணைவிதிகள் அறிவுத்தளம் · ஏலம் அறிந்தது",
    agentAuctionPurpose: "ஏலத்திற்கான லாட்டுகள், மதிப்பீடுகள் மற்றும் விலைகளைத் தேடுங்கள்.",
    agentAuctionCaps: "லாட் தேடல் · தரம் மற்றும் தரகர் விலைகள் · ஏலம் அறிந்தது",
    agentAnalyticsPurpose: "தரகர்கள், தரங்கள் மற்றும் 13 ஆண்டு போக்குகளை ஒப்பிடுங்கள்.",
    agentAnalyticsCaps: "ஆழமாகச் செல்லும் விளக்கப்படங்கள் · பின் செய்த நுண்ணறிவுகள் · இந்த விளக்கப்படத்தை விளக்கு",
    agentReportsPurpose: "அறிக்கை அல்லது விளக்கக்காட்சியை உருவாக்கி ஏற்றுமதி செய்யுங்கள்.",
    agentReportsCaps: "தனிப்பயன் அறிக்கைகள் · PowerPoint · Excel · PDF · குரல்",
    hubAskTitle: "எதையும் கேளுங்கள்",
    hubAskHint: "பொது உதவியாளர் முழு தளத்தையும் உள்ளடக்குகிறது. ஒரு குறிப்பிட்ட வேலைக்கு நிபுணர் வேண்டுமா? கீழே தேர்ந்தெடுங்கள்.",
    hubAskPlaceholder: "லாட், தரகர், விற்பனை அல்லது துணைவிதி பற்றி கேளுங்கள்…",
    hubAskLabel: "உங்கள் கேள்வி",
    hubAskSend: "கேளுங்கள்",
    hubSpecialists: "அல்லது ஒரு வேலைக்கு நிபுணரைத் தேர்ந்தெடுங்கள்",
    hubPrompt1: "இந்த வாரத்தின் விற்பனையைச் சுருக்குங்கள்",
    hubPrompt2: "எந்த தரகர் சிறப்பாகச் செயல்பட்டார்?",
    hubPrompt3: "CTTA துணைவிதியை விளக்குங்கள்",
  },
};

/** The strings for one language without the hook — for pure tests and non-React callers. */
export function getUiStrings(lang: UiLang): UiStrings {
  return DICT[lang];
}

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
