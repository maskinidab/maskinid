/**
 * The checklist itself: the control points, their texts and the tick boxes.
 *
 * Shared by Daglig kontroll (the owner's operator going through a machine before a shift) and Inbytestest (a
 * dealer appraising a machine before a trade-in). The product owner asked for "samma kontrollpunkter, texter och
 * bockrutor" in both, so they render from one component against the same `checklist_templates` rows (ADR 0031).
 *
 * The two flows differ only in what surrounds the list — a machine picker versus a serial-number lookup — and in
 * what the answer does, which is why only the list and its answer state live here.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon";
import { StatusBadge } from "./StatusBadge";

export interface ChecklistItem { id: string; sv: string; en?: string; critical?: boolean }
export interface ChecklistTemplate { id: string; name: string; items: ChecklistItem[]; builtin: boolean; categories: string[] }

export type CheckResult = "ok" | "remarks" | "failed";
export interface Answer { ok: boolean | null; note: string }

const RESULT_KIND = { ok: "verifierad", remarks: "vantar", failed: "sparr" } as const;

export function CheckResultBadge({ result }: { result: CheckResult }) {
  const { t } = useTranslation();
  return <StatusBadge kind={RESULT_KIND[result]}>{t(`daily.result.${result}`)}</StatusBadge>;
}

/** The item text in the reader's language, falling back to whatever the template has. */
export function itemLabel(i: ChecklistItem, lang: string) {
  return (lang.startsWith("en") ? i.en : i.sv) || i.sv || i.en || i.id;
}

export function useChecklistAnswers() {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const set = (id: string, v: Partial<Answer>) =>
    setAnswers((a) => ({ ...a, [id]: { ...{ ok: null, note: "" }, ...a[id], ...v } }));
  return {
    answers,
    set,
    reset: () => setAnswers({}),
    allOk: (items: ChecklistItem[]) => setAnswers(Object.fromEntries(items.map((i) => [i.id, { ok: true, note: "" }]))),
    missing: (items: ChecklistItem[]) => items.filter((i) => answers[i.id]?.ok == null).length,
    /** The answers as the submit RPCs want them. Call only when `missing` is 0. */
    payload: (items: ChecklistItem[]) => items.map((i) => ({ id: i.id, ok: answers[i.id]!.ok, note: answers[i.id]!.note || null })),
  };
}

export function ChecklistItems({ items, answers, set, legend }: {
  items: ChecklistItem[];
  answers: Record<string, Answer>;
  set(id: string, v: Partial<Answer>): void;
  legend: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <fieldset className="stack-3">
      <legend className="mid-etikett">{legend}</legend>
      <ol className="checklista">
        {items.map((i) => {
          const a = answers[i.id];
          return (
            <li key={i.id} className={a?.ok === false ? "is-fel" : a?.ok ? "is-ok" : undefined}>
              <div className="checklista-rad">
                <span>{itemLabel(i, i18n.language)}{i.critical && <span className="t-liten t-sekundar"> · {t("daily.critical")}</span>}</span>
                <span className="checklista-val" role="radiogroup" aria-label={itemLabel(i, i18n.language)}>
                  <button type="button" role="radio" aria-checked={a?.ok === true}
                    className={`mid-knapp mid-knapp-liten ${a?.ok === true ? "mid-knapp-primar" : "mid-knapp-kontur"}`}
                    onClick={() => set(i.id, { ok: true })}><Icon name="bock" />{t("daily.ok")}</button>
                  <button type="button" role="radio" aria-checked={a?.ok === false}
                    className={`mid-knapp mid-knapp-liten ${a?.ok === false ? "mid-knapp-fara" : "mid-knapp-kontur"}`}
                    onClick={() => set(i.id, { ok: false })}><Icon name="varning" />{t("daily.fault")}</button>
                </span>
              </div>
              {a?.ok === false && (
                <input className="mid-input" aria-label={t("daily.fault_note")} placeholder={t("daily.fault_note")} value={a.note}
                  onChange={(e) => set(i.id, { note: e.target.value })} />
              )}
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}
