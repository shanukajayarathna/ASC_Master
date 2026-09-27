// Golden dialogues for the AI Assistant: scripted button-taps through the real /api/v1/assistant/chat endpoint, with each
// final figure cross-checked against the archive engine's own numbers (POST /api/v1/msl/analytics/filtered), so a wrong
// filter, period or measure anywhere in the guided flow shows up as a mismatch. No model is involved for these cases.
//
//   ASC_SESSION=<jwt of a real user>  [ASC_API=http://localhost:5058]  node scripts/assistant-golden/run.mjs
//
// ASC_SESSION is the value of the asc_session cookie (see the ui-smoke-test notes). Run against a backend built from this code.
import { readFileSync } from "node:fs";

const API = process.env.ASC_API ?? "http://localhost:5058";
const SESSION = process.env.ASC_SESSION;
if (!SESSION) { console.error("Set ASC_SESSION to a signed-in user's asc_session token."); process.exit(2); }
const headers = { "Content-Type": "application/json", Cookie: `asc_session=${SESSION}`, "X-Requested-With": "ASC" };

const api = async (path, body) => {
  const res = await fetch(API + path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};
const NULL_FILTER = Object.fromEntries("Years SaleNos Months Quarters Brokers Elevations Grades Categories GradeTypes TeaTypes Manufactures Buyers Marks Factories MarkTypes Groups SaleType SoldStatus RefuseTea PriceMin PriceMax MarkSearch BuyerSearch LotNos Invoices Bags Packings Districts SharingStatus Organic".split(" ").map((k) => [k, null]));
const fmt = (v, unit) => (unit === "price" ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(v).toLocaleString("en-US"));

// What exists right now, so the cases never hard-code a sale.
const sales = (await api("/api/v1/msl/analytics/sales")).filter((s) => s.saleNo > 0);
const latest = sales[0];
const ctx = { year: latest.year, no: latest.saleNo, latest: `${latest.saleNo}/${latest.year}` };
const leaderOf = async (filter, section, field) => {
  const dto = await api("/api/v1/msl/analytics/filtered?lite=true", { ...NULL_FILTER, ...filter });
  const rows = dto[section].filter((r) => r[field] != null);
  return rows.reduce((a, b) => (b[field] > a[field] ? b : a));
};
ctx.topGrade = (await leaderOf({ Years: [ctx.year], SaleNos: [ctx.no] }, "byGrade", "soldQtyKg")).key;

const sub = (s) => s.replace(/\{(\w+)\}/g, (_, k) => ctx[k]);
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
let failed = 0;

for (const c of cases) {
  const problems = [];
  let conversationId = null;
  let last = null;
  for (const [i, raw] of c.turns.entries()) {
    const message = sub(raw);
    last = await api("/api/v1/assistant/chat", { conversationId, message, agent: "auto", provider: "local", localHour: 10 });
    conversationId = last.conversationId;
    const want = c.asks?.[i];
    if (want) {
      const q = /CLARIFY:\s*(\{.*\})/.exec(last.reply);
      const asked = q ? JSON.parse(q[1]) : null;
      if (!asked || asked.question !== sub(want.question)) problems.push(`turn ${i + 1}: expected question "${sub(want.question)}", got ${asked ? `"${asked.question}"` : "an answer"}`);
      for (const o of want.options ?? []) if (!asked?.options.includes(sub(o))) problems.push(`turn ${i + 1}: option "${sub(o)}" missing`);
    }
  }
  if (c.final?.provider && last.provider !== c.final.provider) problems.push(`final answer came from "${last.provider}", expected "${c.final.provider}"`);
  for (const t of c.final?.contains ?? []) if (!last.reply.includes(sub(t))) problems.push(`answer lacks "${sub(t)}"`);
  if (last.reply.includes("⚠")) problems.push("answer carries an unverified-figure warning");
  if (c.final?.provider === "direct" && !/Scope: .* · Source: /.test(last.reply)) problems.push("no scope/source line");

  if (c.check) {
    const filter = JSON.parse(sub(JSON.stringify(c.check.filter)));
    const leader = await leaderOf(filter, c.check.section, c.check.field);
    const shown = fmt(leader[c.check.field], c.check.unit);
    if (!last.reply.includes(shown)) problems.push(`expected the engine's ${c.check.field} ${shown} (${leader.key}) in the answer`);
    if (c.check.name && !last.reply.includes(leader.key)) problems.push(`expected "${leader.key}" in the answer`);
  }
  console.log(`${problems.length ? "FAIL" : "ok  "}  ${c.name}`);
  for (const p of problems) console.log(`      - ${p}`);
  if (problems.length) failed++;
}
console.log(`\n${cases.length - failed}/${cases.length} golden dialogues passed (latest archived sale ${ctx.latest}).`);
process.exit(failed ? 1 : 0);
