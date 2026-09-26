/**
 * Formulär för ändringar i en registerpost. Varje formulär anropar API:t och
 * lämnar tillbaka den uppdaterade registerposten via onDone.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { FormField } from "../../components/FormField";
import { Notice } from "../../components/Notice";
import { api, ApiError } from "../../lib/api";
import { BLOCK_REASON_LABEL, type BlockReason, type MachineRecord } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

interface FormProps {
  record: MachineRecord;
  onDone(record: MachineRecord, message: string): void;
  onCancel(): void;
}

const today = () => new Date().toISOString().slice(0, 10);
const inOneYear = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Något gick fel. Försök igen om en stund.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function Actions({ busy, label, onCancel, danger }: { busy: boolean; label: string; onCancel(): void; danger?: boolean }) {
  return (
    <div className="mid-rad">
      <button className={`mid-knapp ${danger ? "mid-knapp-sekundar" : "mid-knapp-primar"}`} type="submit" disabled={busy}>
        {busy ? "Sparar" : label}
      </button>
      <button className="mid-knapp mid-knapp-kontur" type="button" onClick={onCancel} disabled={busy}>
        Avbryt
      </button>
    </div>
  );
}

function Form({ onSubmit, error, children }: { onSubmit(e: FormEvent): void; error: string | null; children: ReactNode }) {
  return (
    <form className="stack-4" onSubmit={onSubmit} noValidate>
      {error && <Notice kind="fel" title={error} />}
      {children}
    </form>
  );
}

export function PledgeForm({ record, onDone, onCancel }: FormProps) {
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const s = useSubmit();

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = amount.replace(/[\s ]/g, "").replace(/kr$/i, "");
    if (clean && !/^\d+$/.test(clean)) {
      setAmountError("Ange beloppet i hela kronor, till exempel 1 250 000.");
      return;
    }
    setAmountError(null);
    void s.run(async () => {
      const r = await api.registerPledge({
        machineId: record.machine.id,
        reference: reference.trim() || null,
        amountSek: clean ? Number(clean) : null,
      });
      onDone(r, "Belåning registrerad");
    });
  }

  return (
    <Form onSubmit={submit} error={s.error}>
      <p className="t-liten t-sekundar">
        Belåningen registreras med din organisation som långivare. Beloppet visas bara för dig och den registrerade ägaren.
      </p>
      <FormField label="Avtalsnummer" hint="Er egen referens till kreditavtalet." optional>
        <input className="mid-input" value={reference} onChange={(e) => setReference(e.target.value)} />
      </FormField>
      <FormField label="Belånat belopp" hint="I hela kronor." optional error={amountError}>
        <input className="mid-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </FormField>
      <Actions busy={s.busy} label="Registrera belåning" onCancel={onCancel} />
    </Form>
  );
}

export function InsuranceForm({ record, onDone, onCancel }: FormProps) {
  const [coverage, setCoverage] = useState("Maskinförsäkring");
  const [policy, setPolicy] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(inOneYear);
  const [dateError, setDateError] = useState<string | null>(null);
  const s = useSubmit();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!from || !to || to <= from) {
      setDateError("Slutdatum måste vara efter startdatum.");
      return;
    }
    setDateError(null);
    void s.run(async () => {
      const r = await api.registerInsurance({
        machineId: record.machine.id,
        coverage,
        policyNumber: policy.trim() || null,
        validFrom: from,
        validTo: to,
      });
      onDone(r, "Försäkring registrerad");
    });
  }

  return (
    <Form onSubmit={submit} error={s.error}>
      <p className="t-liten t-sekundar">En tidigare registrerad försäkring avslutas när den nya registreras.</p>
      <FormField label="Försäkringsform">
        <select className="mid-select" value={coverage} onChange={(e) => setCoverage(e.target.value)}>
          <option>Maskinförsäkring</option>
          <option>Maskinförsäkring, allrisk</option>
          <option>Trafikförsäkring</option>
          <option>Ansvarsförsäkring</option>
        </select>
      </FormField>
      <FormField label="Försäkringsnummer" optional>
        <input className="mid-input" value={policy} onChange={(e) => setPolicy(e.target.value)} />
      </FormField>
      <div className="formular-rutnat">
        <FormField label="Gäller från">
          <input className="mid-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField label="Gäller till" error={dateError}>
          <input className="mid-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
      </div>
      <Actions busy={s.busy} label="Registrera försäkring" onCancel={onCancel} />
    </Form>
  );
}

export function BlockForm({ record, onDone, onCancel }: FormProps) {
  const [reason, setReason] = useState<BlockReason>("stulen");
  const [police, setPolice] = useState("");
  const [description, setDescription] = useState("");
  const [policeError, setPoliceError] = useState<string | null>(null);
  const s = useSubmit();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (reason === "stulen" && !police.trim()) {
      setPoliceError("Ange polisens diarienummer. Det står på anmälningskvittot.");
      return;
    }
    setPoliceError(null);
    void s.run(async () => {
      const r = await api.reportBlock({
        machineId: record.machine.id,
        reason,
        description: description.trim() || null,
        policeReportNumber: police.trim() || null,
      });
      onDone(r, reason === "stulen" ? "Maskinen anmäld stulen" : "Spärr registrerad");
    });
  }

  const reasons: BlockReason[] = ["stulen", "avvikelse"];
  return (
    <Form onSubmit={submit} error={s.error}>
      <fieldset>
        <legend className="mid-etikett">Orsak</legend>
        <div className="mid-val">
          {reasons.map((r) => (
            <label key={r}>
              <input type="radio" name="orsak" value={r} checked={reason === r} onChange={() => setReason(r)} />
              <span>
                {BLOCK_REASON_LABEL[r]}
                <small>{r === "stulen" ? "Kräver polisanmälan." : "Uppgifterna stämmer inte med maskinen."}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <FormField label="Polisens diarienummer" optional={reason !== "stulen"} error={policeError}>
        <input className="mid-input is-id" value={police} onChange={(e) => setPolice(e.target.value)} placeholder="Till exempel 5000-K123456-26" />
      </FormField>
      <FormField label="Beskrivning" hint="Visas i registerposten för alla som söker." optional>
        <textarea className="mid-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>
      <Actions busy={s.busy} label="Registrera spärr" onCancel={onCancel} danger />
    </Form>
  );
}

export function TransferForm({ record, onDone, onCancel }: FormProps) {
  const orgs = useAsync(() => api.listOrganizations(), []);
  const [newOwner, setNewOwner] = useState("");
  const [date, setDate] = useState(today);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const s = useSubmit();
  const candidates = (orgs.data ?? []).filter(
    (o) => o.id !== record.owner?.ownerOrganizationId && (o.type === "maskinagare" || o.type === "maskinhandlare"),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!newOwner) {
      setOwnerError("Välj den nya registrerade ägaren.");
      return;
    }
    setOwnerError(null);
    void s.run(async () => {
      const r = await api.transferOwnership({
        machineId: record.machine.id,
        newOwnerOrganizationId: newOwner,
        effectiveFrom: `${date}T00:00:00Z`,
      });
      onDone(r, "Ägarbyte registrerat");
    });
  }

  return (
    <Form onSubmit={submit} error={s.error}>
      <p className="t-liten t-sekundar">
        Registrerade belåningar ligger kvar efter ägarbytet. Långivaren ser att maskinen har bytt ägare.
      </p>
      <FormField label="Ny registrerad ägare" error={ownerError}>
        <select className="mid-select" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} disabled={orgs.loading}>
          <option value="">{orgs.loading ? "Hämtar organisationer" : "Välj organisation"}</option>
          {candidates.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.orgNr})
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Ägarbytet gäller från">
        <input className="mid-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </FormField>
      <Actions busy={s.busy} label="Registrera ägarbyte" onCancel={onCancel} />
    </Form>
  );
}

/** Administratören bekräftar att PIN/serienummer stämmer med maskinens typskylt. */
export function VerifyForm({ record, onDone, onCancel }: FormProps) {
  const [note, setNote] = useState("");
  const s = useSubmit();
  const m = record.machine;
  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(async () => onDone(await api.verifyIdentity(m.id, note.trim() || null), "Identitet verifierad"));
      }}
      error={s.error}
    >
      <p className="t-brodtext">Bekräfta att uppgifterna stämmer med maskinens typskylt.</p>
      <dl className="definitioner">
        <dt>PIN</dt>
        <dd className={m.pin ? "mid-id" : "t-sekundar"}>{m.pin ?? "Uppgift saknas"}</dd>
        <dt>Serienummer</dt>
        <dd className={m.serialNumber ? "mid-id" : "t-sekundar"}>{m.serialNumber ?? "Uppgift saknas"}</dd>
        <dt>Maskin</dt>
        <dd>{m.manufacturer} {m.model}{m.modelYear ? `, ${m.modelYear}` : ""}</dd>
      </dl>
      <FormField label="Hur kontrollerades uppgifterna?" hint="Visas i historiken, till exempel Kontrollerad på plats i Umeå." optional>
        <input className="mid-input" value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <Actions busy={s.busy} label="Verifiera identitet" onCancel={onCancel} />
    </Form>
  );
}

/** Bekräftelse för enkla handlingar (avsluta belåning, häv spärr). */
export function ConfirmForm({
  text,
  label,
  action,
  message,
  onDone,
  onCancel,
}: {
  text: string;
  label: string;
  action(): Promise<MachineRecord>;
  message: string;
  onDone(r: MachineRecord, message: string): void;
  onCancel(): void;
}) {
  const s = useSubmit();
  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(async () => onDone(await action(), message));
      }}
      error={s.error}
    >
      <p className="t-brodtext">{text}</p>
      <Actions busy={s.busy} label={label} onCancel={onCancel} danger />
    </Form>
  );
}
