"use client";

import PageHeader from "@/components/shared/PageHeader";
import { useCatalogue } from "@/context/CatalogueContext";
import { useUiLang, type UiLang } from "@/lib/i18n";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "next/link";
import "./agent-hub.css";
import { SPECIALISTS } from "./agents";
import AskHero from "./AskHero";
import SpecialistLink from "./SpecialistLink";
import { useReducedMotion } from "./useHubEnv";

const LANG_CYCLE: readonly UiLang[] = ["en", "si", "ta"];
const LANG_LABEL = new Map<UiLang, string>([["en", "EN"], ["si", "සිං"], ["ta", "த"]]);

/**
 * The AI Assistant hub. The primary action is simply to ask (General answers); the specialists below are a
 * compact row of links for someone who already knows they want one particular job done, so nobody has to
 * understand the agents before they can start. Each leads to its own workspace under /assistant/<agent>. It
 * is an ordinary module page — the shared PageHeader and the app's own tokens and card styling. The shell's
 * Topbar already provides search, the year/sale picker and the theme, so the header actions add just the sale
 * in context, a language toggle and a way back to the classic chat.
 */
export default function AgentHub() {
  const { t, lang, setLang } = useUiLang();
  const { activeCatalogue } = useCatalogue();
  const reduced = useReducedMotion();
  const nextLang = LANG_CYCLE.at((LANG_CYCLE.indexOf(lang) + 1) % LANG_CYCLE.length) ?? "en";

  return (
    <div className="agent-hub">
      <PageHeader
        title={t.assistantTitle}
        subtitle={t.hubSub}
        actions={
          <>
            <Chip size="small" variant="outlined" label={activeCatalogue ? activeCatalogue.sourceName : t.hubNoSale} />
            <Button
              size="small"
              variant="outlined"
              onClick={() => setLang(nextLang)}
              aria-label={`${t.hubLangLabel}: ${LANG_LABEL.get(lang)}`}
              sx={{ minHeight: 44, minWidth: 52 }}
            >
              {LANG_LABEL.get(lang)}
            </Button>
            <Button size="small" variant="outlined" component={Link} href="/assistant/classic" sx={{ minHeight: 44 }}>
              {t.hubOpenClassic}
            </Button>
          </>
        }
      />

      <div className="hub-content">
        <AskHero t={t} reduced={reduced} />

        <section aria-labelledby="hub-spec-title" className="hub-specialists">
          <h2 id="hub-spec-title" className="hub-eyebrow hub-kicker">{t.hubSpecialists}</h2>
          <div className="hub-row">
            {SPECIALISTS.map((agent) => (
              <SpecialistLink key={agent.key} agent={agent} t={t} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
