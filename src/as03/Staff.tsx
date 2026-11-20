import { useEffect, useState, type FormEvent } from "react";
import { LockKeyhole, Plus, Save, Upload } from "lucide-react";

import { api, errorMessage, RequestError } from "./client";
import { categories, editableFields, fieldLabels, isRecordKind } from "./contracts";
import type { Fields, RecordKind, StaffRecord } from "./contracts";

type Editor = { id?: string; kind: RecordKind; version?: number; fields: Fields };

const empty = (kind: RecordKind = "event"): Editor => ({ kind, fields: {} });

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

  async function run(operation: () => Promise<void>, feedback = "") {
    setBusy(true);
    setError("");
    setNotice("");
    setIssues({});
    try {
      await operation();
      setNotice(feedback);
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

  function select(record?: Editor) {
    setEditor(record);
    setDirty(false);
    setConfirmWithdraw(false);
    setError("");
    setIssues({});
    setNotice("");
  }

  function update(field: string, value: string) {
    setEditor((current) => current ? { ...current, fields: { ...current.fields, [field]: value } } : current);
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
        void run(async () => {
          await api("staff/session", { method: "DELETE" });
          setActive(false); setRecords([]); select();
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
        void run(async () => {
          const path = editor.id ? `staff/records/${editor.id}` : "staff/records";
          receive(await api<StaffRecord>(path, {
            method: editor.id ? "PUT" : "POST",
            body: { kind: editor.kind, version: editor.version, fields: editor.fields },
          }));
        }, "Draft saved.");
      }}>
        <div className="as03-row"><h2>{editor.id ? "Edit draft" : "New record"}</h2>
          {editor.id && <small>Draft v{editor.version} · {selected?.publishedVersion ? `Published v${selected.publishedVersion}` : "Unpublished"}</small>}
        </div>
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
            return <div className={`as03-field ${field === "summary" ? "as03-full-field" : ""}`} key={field}><label>
              {fieldLabels[field]}
              {field === "destinationIds" ?
                <select aria-invalid={invalid} aria-describedby={errorId} multiple value={value.split(",").filter(Boolean)} onChange={(event) =>
                  update(field, Array.from(event.target.selectedOptions, (option) => option.value).join(","))}>
                  {records.filter(({ kind }) => kind === "destination").map((destination) =>
                    <option value={destination.id} key={destination.id}>{destination.fields.title || "Untitled destination"}</option>)}
                </select> : field === "status" || field === "area" ? <select aria-invalid={invalid} aria-describedby={errorId} value={value} onChange={(event) => update(field, event.target.value)}>
                  <option value="">Choose an option</option>
                  {(field === "status" ? ["scheduled", "postponed", "cancelled"] : ["sarawak", "destination"]).map((option) =>
                    <option value={option} key={option}>{option === "sarawak" ? "Across Sarawak" : option === "destination" ? "Destination-specific" : option[0].toUpperCase() + option.slice(1)}</option>)}
                </select> : field === "summary" ? <textarea rows={4} aria-invalid={invalid} aria-describedby={errorId} maxLength={2000} value={value} onChange={(event) => update(field, event.target.value)} />
                : <input type={field === "startsAt" ? "datetime-local" : "text"} maxLength={2000} aria-invalid={invalid} aria-describedby={errorId} value={value} onChange={(event) => update(field, event.target.value)} />}
              </label>{issues[field] && <small id={errorId} className="as03-field-error">{issues[field]}</small>}
            </div>;
          })}
        </div>
        {dirty && editor.id && <p className="as03-meta">Save changes before publishing.</p>}
        <div className="as03-row">
          <button className="as03-button" disabled={busy}><Save size={17} /> Save draft</button>
          <button className="as03-outline" type="button" disabled={busy || dirty || !editor.id} onClick={() => {
            void run(async () => receive(await api<StaffRecord>(`staff/records/${editor.id}/publish`, {
              method: "POST", body: { version: editor.version },
            })), "Published to the catalogue.");
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
