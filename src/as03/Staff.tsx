import { useEffect, useRef, useState, type FormEvent } from "react";
import { LockKeyhole, Plus, Save, Upload } from "lucide-react";

import { api, errorMessage, RequestError } from "./client";
import { categories, editableFields, fieldLabels, isRecordKind } from "./contracts";
import type { Fields, RecordKind, StaffRecord } from "./contracts";
import { needsDestinations, optionsFor, updateFields } from "./fieldPresentation";
import { compareDraft, isStale, rebaseDraft } from "./recovery";

type Editor = { id?: string; kind: RecordKind; version?: number; fields: Fields };
type Conflict = { base: StaffRecord; latest: StaffRecord };

const empty = (kind: RecordKind = "event"): Editor => ({ kind, fields: {} });
const fieldNames = (keys: string[]) => keys.map((key) => fieldLabels[key] ?? key).join(", ");

export function Staff() {
  const [active, setActive] = useState<boolean>();
  const [records, setRecords] = useState<StaffRecord[]>([]);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Fields>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [conflict, setConflict] = useState<Conflict>();
  const conflictNotice = useRef<HTMLDivElement>(null);

  useEffect(() => { if (conflict) conflictNotice.current?.focus(); }, [conflict]);

  useEffect(() => {
    let live = true;
    void api<{ active: boolean }>("staff/session").then(async (session) => {
      const drafts = session.active ? await api<StaffRecord[]>("staff/records") : [];
      if (live) { setActive(session.active); setRecords(drafts); }
    }).catch((cause: unknown) => {
      if (live) { setError(errorMessage(cause)); setActive(false); }
    });
    return () => { live = false; };
  }, []);

  async function run(operation: () => Promise<unknown>, feedback = "") {
    setBusy(true);
    setError("");
    setNotice("");
    setIssues({});
    try {
      const outcome = await operation();
      setNotice(outcome === false ? "" : feedback);
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof RequestError) {
        setIssues(cause.issues ?? {});
        if (cause.status === 401 && active) {
          setActive(false);
          setRecords([]);
          setEditor(undefined);
        }
      }
    } finally { setBusy(false); }
  }

  function open(record?: Editor) {
    setEditor(record);
    setDirty(false);
    setConfirmWithdraw(false);
    setConflict(undefined);
    setError("");
    setIssues({});
    setNotice("");
  }

  function keepUnsaved() {
    return !dirty || window.confirm("Discard your unsaved changes to this draft?");
  }

  function select(record?: Editor) {
    if (keepUnsaved()) open(record);
  }

  function update(field: string, value: string) {
    setEditor((current) => current ? { ...current, fields: updateFields(current.kind, current.fields, field, value) } : current);
    setDirty(true);
  }

  function receive(record: StaffRecord) {
    setEditor(record);
    setRecords((current) => {
      if (!current.some(({ id }) => id === record.id)) return [...current, record];
      return current.map((item) => item.id === record.id ? record : item);
    });
    setDirty(false);
    setConfirmWithdraw(false);
    setConflict(undefined);
  }

  async function recover(cause: unknown, current: Editor) {
    if (!isStale(cause) || !current.id) throw cause;
    const base = records.find(({ id }) => id === current.id);
    const latestRecords = await api<StaffRecord[]>("staff/records");
    const latest = latestRecords.find(({ id }) => id === current.id);
    if (!base || !latest) throw new Error("This record is no longer available. Reopen the staff workspace.");
    setRecords(latestRecords);
    setConflict({ base, latest });
    return false;
  }

  function keepEdits(current: Editor, { base, latest }: Conflict) {
    setEditor({ ...current, version: latest.version, fields: rebaseDraft(base.fields, current.fields, latest.fields) });
    setDirty(true);
    setConflict(undefined);
    setError("");
    setNotice(`Your edits now apply to draft v${latest.version}. Review them, then save.`);
  }

  function loadLatest({ latest }: Conflict) {
    open(latest);
    setNotice(`Loaded draft v${latest.version}.`);
  }

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    void run(async () => {
      await api("staff/session", { method: "POST", body: { password } });
      setRecords(await api<StaffRecord[]>("staff/records"));
      setActive(true);
    }, "Signed in.");
  }

  const shown = records.filter((item) => (!category || item.kind === category) &&
    item.fields.title.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = records.find(({ id }) => id === editor?.id);

  return <div className="as03-stack">
    <div className="as03-row as03-section-title">
      <div><p className="as03-meta"><LockKeyhole size={18} /> Staff workspace</p><h1>Manage tourism information</h1></div>
      {active && <button className="as03-outline" disabled={busy} onClick={() => {
        if (!keepUnsaved()) return;
        void run(async () => {
          await api("staff/session", { method: "DELETE" });
          setActive(false); setRecords([]); open();
        }, "Signed out.");
      }}>Sign out</button>}
    </div>
    {error && <p className="as03-error" role="alert">{error}</p>}
    {notice && <p className="as03-success" role="status">{notice}</p>}
    {active === undefined && <p role="status">Checking staff session…</p>}
    {active === false && <form className="as03-panel as03-signin" onSubmit={login}>
      <h2>Staff sign-in</h2><p>Sign in to save drafts and publish updates.</p>
      <label>Staff password<input type="password" name="password" autoComplete="current-password" required maxLength={200} /></label>
      <button className="as03-button" disabled={busy}><LockKeyhole size={17} /> Sign in</button>
    </form>}
    {active && <div className="as03-staff-layout">
      <section className="as03-panel" aria-label="Staff records">
        <div className="as03-row"><h2>Records</h2><button className="as03-outline" onClick={() => select(empty(isRecordKind(category) ? category : "event"))}><Plus size={16} /> New draft</button></div>
        <label className="as03-field">Filter category<select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {Object.entries(categories).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
        <label className="as03-field">Find a record<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {!shown.length && <p>No records match.</p>}
        <ul className="as03-staff-list">
          {shown.map((item) => <li key={item.id}><button aria-pressed={editor?.id === item.id} onClick={() => select(item)}>
            <span>{item.fields.title || "Untitled draft"}</span><small>{categories[item.kind]} · {item.publishedVersion ? "Published" : "Draft only"}</small>
          </button></li>)}
        </ul>
      </section>
      {editor ? <form className="as03-panel as03-editor" onSubmit={(event) => {
        event.preventDefault();
        const current = editor;
        void run(async () => {
          const path = current.id ? `staff/records/${current.id}` : "staff/records";
          try {
            receive(await api<StaffRecord>(path, {
              method: current.id ? "PUT" : "POST",
              body: { kind: current.kind, version: current.version, fields: current.fields },
            }));
          } catch (cause) { return recover(cause, current); }
        }, "Draft saved.");
      }}>
        <div className="as03-row"><h2>{editor.id ? "Edit draft" : "New record"}</h2>
          {editor.id && <small>Draft v{editor.version} · {selected?.publishedVersion ? `Published v${selected.publishedVersion}` : "Unpublished"}</small>}
        </div>
        {conflict && (() => {
          const { changedHere, changedElsewhere, overlapping } = compareDraft(conflict.base.fields, editor.fields, conflict.latest.fields);
          const { base, latest } = conflict;
          return <div className="as03-stale" role="alert" tabIndex={-1} ref={conflictNotice}>
            <h3>A newer version of this draft exists</h3>
            <p>Draft v{latest.version} was saved in another window or staff session after you opened v{base.version}. Nothing from this editor was saved{changedHere.length ? ". Your edits are still below" : ""}.</p>
            <ul>
              {base.publishedVersion !== latest.publishedVersion && <li>{latest.publishedVersion ? `The public record is now v${latest.publishedVersion}.` : "The public record has been withdrawn."}</li>}
              {changedElsewhere.length > 0 && <li>Changed in v{latest.version}: {fieldNames(changedElsewhere)}.</li>}
              {changedHere.length > 0 && <li>Your unsaved edits: {fieldNames(changedHere)}.</li>}
              {overlapping.length > 0 && <li>Changed in both: {fieldNames(overlapping)}. Keeping your edits replaces the newer values for these fields.</li>}
            </ul>
            <div className="as03-row">
              {changedHere.length > 0 && <button type="button" className="as03-button" disabled={busy} onClick={() => keepEdits(editor, conflict)}>Keep my edits on v{latest.version}</button>}
              <button type="button" className="as03-outline" disabled={busy} onClick={() => loadLatest(conflict)}>
                {changedHere.length ? `Load v${latest.version} and discard my edits` : `Load v${latest.version}`}
              </button>
            </div>
          </div>;
        })()}
        <label className="as03-field">Category<select disabled={Boolean(editor.id)} value={editor.kind} onChange={(event) => {
          if (isRecordKind(event.target.value)) select(empty(event.target.value));
        }}>
          {Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <div className="as03-editor-fields">
          {editableFields(editor.kind).map((field) => {
            const value = editor.fields[field] ?? "";
            const invalid = Boolean(issues[field]);
            const errorId = invalid ? `as03-issue-${field}` : undefined;
            const choices = optionsFor(field);
            if (field === "destinationIds" && !needsDestinations(editor.kind, editor.fields))
              return <div className="as03-field as03-coverage-note" key={field} role="note" aria-label={fieldLabels[field]}>
                <strong>{fieldLabels[field]}</strong>
                <p>{editor.fields.area === "sarawak"
                  ? "Not needed. This guidance applies across Sarawak, so it is not linked to specific destinations."
                  : "Choose a coverage first. Destination-specific guidance needs at least one destination."}</p>
              </div>;
            const hintId = field === "destinationIds" && editor.kind === "visitor" ? "as03-hint-destinationIds" : undefined;
            const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
            return <div className={`as03-field ${field === "summary" ? "as03-full-field" : ""}`} key={field}><label>
              {fieldLabels[field]}
              {field === "destinationIds" ?
                <select aria-invalid={invalid} aria-describedby={describedBy} multiple value={value.split(",").filter(Boolean)} onChange={(event) =>
                  update(field, Array.from(event.target.selectedOptions, (option) => option.value).join(","))}>
                  {records.filter(({ kind }) => kind === "destination").map((destination) =>
                    <option value={destination.id} key={destination.id}>{destination.fields.title || "Untitled destination"}</option>)}
                </select> : choices ? <select aria-invalid={invalid} aria-describedby={errorId} value={value} onChange={(event) => update(field, event.target.value)}>
                  <option value="">Choose an option</option>
                  {choices.map(([option, label]) => <option value={option} key={option}>{label}</option>)}
                </select> : field === "summary" ? <textarea rows={4} aria-invalid={invalid} aria-describedby={errorId} maxLength={2000} value={value} onChange={(event) => update(field, event.target.value)} />
                : <input type={field === "startsAt" ? "datetime-local" : "text"} maxLength={2000} aria-invalid={invalid} aria-describedby={errorId} value={value} onChange={(event) => update(field, event.target.value)} />}
              </label>{hintId && <small id={hintId} className="as03-field-hint">Choose at least one destination before publishing.</small>}
              {issues[field] && <small id={errorId} className="as03-field-error">{issues[field]}</small>}
            </div>;
          })}
        </div>
        {dirty && editor.id && <p className="as03-meta">Save changes before publishing.</p>}
        <div className="as03-row">
          <button className="as03-button" disabled={busy || Boolean(conflict)}><Save size={17} /> Save draft</button>
          <button className="as03-outline" type="button" disabled={busy || dirty || !editor.id || Boolean(conflict)} onClick={() => {
            const current = editor;
            void run(async () => {
              try {
                receive(await api<StaffRecord>(`staff/records/${current.id}/publish`, {
                  method: "POST", body: { version: current.version },
                }));
              } catch (cause) { return recover(cause, current); }
            }, "Published to the catalogue.");
          }}><Upload size={17} /> Publish</button>
          {selected?.publishedVersion && <button className="as03-text-button" type="button" disabled={busy || dirty} onClick={() => setConfirmWithdraw(true)}>Withdraw</button>}
        </div>
        {confirmWithdraw && <div className="as03-row as03-withdraw">
          <p>Withdraw the public record?</p>
          <button className="as03-outline" type="button" disabled={busy} onClick={() => {
            void run(async () => receive(await api<StaffRecord>(`staff/records/${editor.id}/withdraw`, { method: "POST" })), "Record withdrawn.");
          }}>Confirm withdrawal</button>
          <button className="as03-text-button" type="button" onClick={() => setConfirmWithdraw(false)}>Cancel</button>
        </div>}
      </form> : <div className="as03-panel"><h2>Draft editor</h2><p>Select a record or create a draft.</p></div>}
    </div>}
  </div>;
}
