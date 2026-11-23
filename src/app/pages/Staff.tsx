import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { History, LayoutDashboard, PenSquare, Plus, Save, Send, ShieldAlert, UserPlus, Users, Undo2 } from "lucide-react";

import { api, errorMessage, RequestError } from "../../lib/api";
import { destinationHint, destinationOptions } from "../../lib/destinationSelection";
import { needsDestinations, updateFields } from "../../lib/fieldPresentation";
import { compareDraft, isStale, rebaseDraft } from "../../lib/recovery";
import { planRestore, retainDraft, type Editor, type Retained } from "../../lib/sessionRecovery";
import { fieldSpecs, splitTags, type FieldSpec } from "../../shared/catalogue";
import { categories, isRecordKind, type Account, type Fields, type RecordActivity, type RecordKind, type StaffRecord } from "../../shared/contracts";
import { DestinationPicker } from "../DestinationPicker";
import { Link } from "../router";
import { isStaff, useSession } from "../session";
import { formatDay, Loading, Notice, photos, useTitle } from "../ui";

type Status = "all" | "published" | "changes" | "unpublished";
const state = (record: StaffRecord) => record.publishedVersion === null ? "Not published" : record.publishedVersion === record.version ? "Published" : `Published v${record.publishedVersion}, draft v${record.version}`;
const blank = (kind: RecordKind): Fields => Object.fromEntries(fieldSpecs(kind).map(({ key }) => [key, ""]));

function FieldInput({ spec, kind, fields, issues, records, onChange }: {
  spec: FieldSpec; kind: RecordKind; fields: Fields; issues: Fields; records: StaffRecord[]; onChange: (key: string, value: string) => void;
}) {
  const value = fields[spec.key] ?? "";
  const id = `field-${spec.key}`;
  const error = issues[spec.key];
  const described = [spec.hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = { id, "aria-invalid": error ? true : undefined, "aria-describedby": described } as const;
  const wide = spec.type === "longtext" || spec.type === "tags" || spec.type === "destinations";
  const hint = spec.hint && <small id={`${id}-hint`}>{spec.hint}</small>;
  const problem = error && <p className="field-error" id={`${id}-error`}>{error}</p>;
  if (spec.type === "destinations") {
    if (!needsDestinations(kind, fields)) return kind === "visitor" ? <div className="wide notice info" role="note"><div><strong>{spec.label}</strong><p>Across-Sarawak guidance applies everywhere and does not link to destinations.</p></div></div> : null;
    return <div className="wide field"><span id={`${id}-label`}>{spec.label}</span><small id={`${id}-hint`}>{destinationHint(kind)}</small>
      <DestinationPicker options={destinationOptions(records, value)} value={value} onChange={(next) => onChange(spec.key, next)} hintId={`${id}-hint`} errorId={error ? `${id}-error` : undefined} invalid={Boolean(error)} />{problem}</div>;
  }
  if (spec.type === "tags") return <fieldset className="wide" aria-describedby={described}><legend>{spec.label}</legend>
    <div className="row">{spec.options!.map(([option, text]) => <label className="checkbox" key={option}><input type="checkbox" checked={splitTags(value).includes(option)}
      onChange={(event) => onChange(spec.key, (event.target.checked ? [...splitTags(value), option] : splitTags(value).filter((tag) => tag !== option)).join(","))} />{text}</label>)}</div>{problem}</fieldset>;
  let input;
  if (spec.type === "longtext") input = <textarea {...common} value={value} maxLength={2000} onChange={(event) => onChange(spec.key, event.target.value)} />;
  else if (spec.type === "select" || spec.type === "image") input = <select {...common} value={value} onChange={(event) => onChange(spec.key, event.target.value)}>
    <option value="">{spec.type === "image" ? "No photo" : "Not set"}</option>
    {(spec.type === "image" ? [...photos].map((name) => [name, `${name} (illustrative image)`] as const) : spec.options ?? []).map(([option, text]) => <option key={option} value={option}>{text}</option>)}
    {value && !(spec.type === "image" ? photos.has(value) : spec.options?.some(([option]) => option === value)) && <option value={value}>{value} (not in list)</option>}</select>;
  else input = <input {...common} type={spec.type === "url" ? "url" : "text"} value={value} maxLength={2000}
    placeholder={spec.type === "datetime" ? "2026-12-05 or 2026-12-05T10:00" : undefined} onChange={(event) => onChange(spec.key, event.target.value)} />;
  return <label className={`field${wide ? " wide" : ""}`} htmlFor={id}>{spec.label}{hint}{input}{problem}</label>;
}

function StaffAccounts() {
  const [accounts, setAccounts] = useState<(Account & { status: string })[]>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(() => api<(Account & { status: string })[]>("admin/staff").then(setAccounts).catch((cause) => setError(errorMessage(cause))), []);
  useEffect(() => { void load(); }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(""); setMessage("");
    try {
      await api("admin/staff", { method: "POST", body: Object.fromEntries(new FormData(form)) });
      form.reset(); setMessage("Staff account created. Share the temporary password securely and ask them to change it."); void load();
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function update(id: string, change: Record<string, string>) {
    setError(""); setMessage("");
    try { await api(`admin/staff/${id}`, { method: "PATCH", body: change }); setMessage("Account updated."); void load(); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  return <div className="stack">
    {message && <Notice key={message} tone="ok" focus>{message}</Notice>}{error && <Notice key={error} tone="error" focus>{error}</Notice>}
    <div className="panel table-scroll"><table className="compare-table"><caption className="sr-only">Staff accounts</caption>
      <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{accounts?.map((entry) => <tr key={entry.id}><td>{entry.displayName}</td><td>{entry.email}</td><td>{entry.role === "admin" ? "Administrator" : "Staff"}</td><td>{entry.status === "active" ? "Active" : "Disabled"}</td>
        <td className="row"><button className="button ghost small" onClick={() => update(entry.id, { status: entry.status === "active" ? "disabled" : "active" })}>{entry.status === "active" ? "Disable" : "Enable"}<span className="sr-only"> {entry.displayName}</span></button>
          <button className="button ghost small" onClick={() => update(entry.id, { role: entry.role === "admin" ? "staff" : "admin" })}>{entry.role === "admin" ? "Make staff" : "Make administrator"}<span className="sr-only">: {entry.displayName}</span></button></td></tr>)}</tbody></table></div>
    <form className="panel stack" onSubmit={create}><h2 style={{ margin: 0 }}><UserPlus size={20} aria-hidden="true" /> Add a staff member</h2>
      <div className="editor-grid">
        <label className="field">Name<input type="text" name="displayName" required maxLength={60} /></label>
        <label className="field">Email<input type="email" name="email" required maxLength={254} /></label>
        <label className="field">Role<select name="role" defaultValue="staff"><option value="staff">Staff</option><option value="admin">Administrator</option></select></label>
        <label className="field">Temporary password<input type="password" name="password" required minLength={10} maxLength={200} autoComplete="new-password" /></label>
      </div><div><button className="button primary">Create account</button></div></form>
  </div>;
}

export function StaffPage() {
  const { account, setAccount } = useSession();
  const [tab, setTab] = useState<"overview" | "records" | "accounts">("records");
  const [newKind, setNewKind] = useState<RecordKind>("destination");
  const [records, setRecords] = useState<StaffRecord[]>();
  const [filter, setFilter] = useState<{ kind: RecordKind | ""; status: Status; text: string }>({ kind: "", status: "all", text: "" });
  const [editor, setEditor] = useState<Editor>();
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Fields>({});
  const [conflict, setConflict] = useState<{ base: StaffRecord; latest: StaffRecord }>();
  const [history, setHistory] = useState<RecordActivity[]>();
  const [retained, setRetained] = useState<{ draft: Retained; owner: string }>();
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const owner = useRef<string>("");
  useTitle("Staff console");

  const load = useCallback(async () => { const list = await api<StaffRecord[]>("staff/records"); setRecords(list); return list; }, []);
  useEffect(() => { if (isStaff(account)) { owner.current = account!.id; void load().catch((cause) => setError(errorMessage(cause))); } }, [account, load]);
  useEffect(() => {
    if (!editor?.id) { setHistory(undefined); return; }
    let live = true;
    void api<RecordActivity[]>(`staff/records/${editor.id}/history`).then((entries) => live && setHistory(entries)).catch(() => live && setHistory(undefined));
    return () => { live = false; };
  }, [editor?.id, editor?.version, records]);

  const current = editor?.id ? records?.find(({ id }) => id === editor.id) : undefined;
  const shown = useMemo(() => (records ?? []).filter((record) => (!filter.kind || record.kind === filter.kind) &&
    (filter.status === "all" || (filter.status === "published" && record.publishedVersion === record.version) ||
      (filter.status === "changes" && record.publishedVersion !== null && record.publishedVersion !== record.version) ||
      (filter.status === "unpublished" && record.publishedVersion === null)) &&
    (record.fields.title ?? "").toLowerCase().includes(filter.text.trim().toLowerCase())), [records, filter]);
  const counts = useMemo(() => Object.keys(categories).map((kind) => {
    const list = (records ?? []).filter((record) => record.kind === kind);
    return { kind: kind as RecordKind, published: list.filter((record) => record.publishedVersion !== null).length, pending: list.filter((record) => record.publishedVersion !== record.version).length };
  }), [records]);

  function guard() {
    return !dirty || window.confirm("You have unsaved changes. Discard them?");
  }
  function open(record?: StaffRecord, kind: RecordKind = "destination") {
    if (!guard()) return;
    setEditor(record ? { id: record.id, kind: record.kind, version: record.version, fields: { ...blank(record.kind), ...record.fields } } : { kind, fields: blank(kind) });
    setDirty(false); setIssues({}); setConflict(undefined); setMessage(""); setError(""); setConfirmWithdraw(false);
  }
  function edit(key: string, value: string) {
    if (!editor) return;
    setEditor({ ...editor, fields: updateFields(editor.kind, editor.fields, key, value) }); setDirty(true);
  }
  async function handle(cause: unknown, base?: StaffRecord) {
    if (cause instanceof RequestError && cause.status === 401) {
      const draft = retainDraft(editor, dirty, records ?? []);
      if (draft) setRetained({ draft, owner: owner.current });
      setExpired(true); setAccount(null); return;
    }
    if (isStale(cause) && editor?.id && base) {
      const latest = (await load()).find(({ id }) => id === editor.id);
      if (latest && latest.version !== editor.version) { setConflict({ base, latest }); return; }
    }
    setError(errorMessage(cause));
    if (cause instanceof RequestError && cause.issues) setIssues(cause.issues);
  }
  async function save() {
    if (!editor) return;
    setBusy(true); setError(""); setMessage(""); setIssues({});
    try {
      const saved = editor.id
        ? await api<StaffRecord>(`staff/records/${editor.id}`, { method: "PUT", body: { kind: editor.kind, version: editor.version, fields: editor.fields } })
        : await api<StaffRecord>("staff/records", { method: "POST", body: { kind: editor.kind, fields: editor.fields } });
      await load();
      setEditor({ id: saved.id, kind: saved.kind, version: saved.version, fields: { ...blank(saved.kind), ...saved.fields } });
      setDirty(false); setMessage(`Draft v${saved.version} saved. Tourists still see the published version until you publish.`);
    } catch (cause) { await handle(cause, current); } finally { setBusy(false); }
  }
  async function publish() {
    if (!editor?.id || dirty) return;
    setBusy(true); setError(""); setMessage(""); setIssues({});
    try {
      const published = await api<StaffRecord>(`staff/records/${editor.id}/publish`, { method: "POST", body: { version: editor.version } });
      await load(); setEditor({ ...editor, version: published.version }); setMessage(`Published v${published.version}. Tourists now see this version.`);
    } catch (cause) { await handle(cause, current); } finally { setBusy(false); }
  }
  async function withdraw() {
    if (!editor?.id) return;
    setBusy(true); setError(""); setMessage(""); setConfirmWithdraw(false);
    try { await api(`staff/records/${editor.id}/withdraw`, { method: "POST" }); await load(); setMessage("Withdrawn. Tourists no longer see this record; saved trips keep their stops and show it as unavailable."); }
    catch (cause) { await handle(cause); } finally { setBusy(false); }
  }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const { account: signedIn } = await api<{ account: Account }>("auth/login", { method: "POST", body: { email: form.get("email"), password: form.get("password") } });
      setAccount(signedIn); setExpired(false);
      if (!isStaff(signedIn)) return;
      const list = await load();
      if (retained && retained.owner !== signedIn.id) { setRetained(undefined); setMessage("Signed in as a different staff member, so the previous unsaved edits were discarded."); return; }
      if (retained) {
        const plan = planRestore(retained.draft, list);
        setRetained(undefined);
        if (plan.action === "open") { setEditor(plan.editor); setDirty(true); setMessage("Your unsaved edits were restored. Review and save them."); }
        else if (plan.action === "conflict") { setEditor(plan.editor); setDirty(true); setConflict(plan.conflict); }
        else setError("The record you were editing is no longer available, so your edits could not be restored.");
      }
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  if (account === undefined) return <Loading />;
  if (!isStaff(account)) return <div className="stack" style={{ maxWidth: 520, marginInline: "auto" }}>
    <div><p className="eyebrow"><ShieldAlert size={16} aria-hidden="true" />Staff</p><h1>Staff console</h1></div>
    {expired && <Notice tone="warn" focus title="Your staff session has expired.">{retained ? "Your unsaved edits are kept in this tab only. Sign in again as the same staff member to restore them." : "Sign in again to continue."}</Notice>}
    {account && !expired && <Notice tone="error">Your account does not have staff access.</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {(!account || expired) ? <form className="panel stack" onSubmit={signIn}><h2 style={{ margin: 0 }}>Staff sign-in</h2>
      <label className="field">Email<input type="email" name="email" required autoComplete="username" maxLength={254} /></label>
      <label className="field">Password<input type="password" name="password" required autoComplete="current-password" maxLength={200} /></label>
      <div><button className="button primary" disabled={busy}>Sign in</button></div></form> : <Link to="/">Back to STIS</Link>}
  </div>;

  const diff = conflict && editor ? compareDraft(conflict.base.fields, editor.fields, conflict.latest.fields) : undefined;
  return <div className="stack">
    <div className="spread"><div><p className="eyebrow"><LayoutDashboard size={16} aria-hidden="true" />Staff console</p><h1 style={{ margin: 0 }}>Maintain tourism information</h1>
      <p className="muted">Signed in as {account!.displayName} ({account!.role === "admin" ? "administrator" : "staff"}).</p></div>
      <nav className="row" aria-label="Console sections">
        {(["overview", "records", ...(account!.role === "admin" ? ["accounts"] : [])] as const).map((name) => <button key={name} aria-pressed={tab === name}
          className={`button small ${tab === name ? "primary" : "secondary"}`} onClick={() => setTab(name as typeof tab)}>
          {name === "overview" ? <LayoutDashboard size={16} aria-hidden="true" /> : name === "records" ? <PenSquare size={16} aria-hidden="true" /> : <Users size={16} aria-hidden="true" />}
          {name === "overview" ? "Overview" : name === "records" ? "Records" : "Staff accounts"}</button>)}
      </nav></div>
    {tab === "accounts" && <StaffAccounts />}
    {tab === "overview" && <div className="stats">{counts.map(({ kind, published, pending }) => <button key={kind} className="stat" style={{ textAlign: "left" }}
      onClick={() => { setFilter({ kind, status: "all", text: "" }); setTab("records"); }}><span className="muted">{categories[kind]}</span><strong>{published}</strong><span className="small">published · {pending} with unpublished changes</span></button>)}</div>}
    {tab === "records" && <div className="console">
      <div className="panel stack" style={{ gap: 10 }}>
        <div className="editor-grid">
          <label className="field">Category<select value={filter.kind} onChange={(event) => setFilter({ ...filter, kind: isRecordKind(event.target.value) ? event.target.value : "" })}>
            <option value="">All categories</option>{Object.entries(categories).map(([kind, text]) => <option key={kind} value={kind}>{text}</option>)}</select></label>
          <label className="field">Status<select value={filter.status} onChange={(event) => setFilter({ ...filter, status: event.target.value as Status })}>
            <option value="all">Any</option><option value="published">Published</option><option value="changes">Unpublished changes</option><option value="unpublished">Not published</option></select></label>
        </div>
        <label className="field">Find a record<input type="search" value={filter.text} onChange={(event) => setFilter({ ...filter, text: event.target.value })} /></label>
        <div className="row">
          <label className="sr-only" htmlFor="new-kind">New record category</label>
          <select id="new-kind" style={{ width: "auto", flex: 1 }} value={newKind} onChange={(event) => { if (isRecordKind(event.target.value)) setNewKind(event.target.value); }}>
            {Object.entries(categories).map(([kind, text]) => <option key={kind} value={kind}>{text}</option>)}</select>
          <button className="button secondary small" onClick={() => open(undefined, newKind)}><Plus size={16} aria-hidden="true" />New<span className="sr-only"> {categories[newKind].toLowerCase()} record</span></button>
        </div>
        <p role="status" className="small muted" style={{ margin: 0 }}>{records ? `${shown.length} of ${records.length} records` : "Loading…"}</p>
        <ul className="record-list">{shown.map((record) => <li key={record.id}><button aria-current={editor?.id === record.id} onClick={() => open(record)}>
          <strong>{record.fields.title || "Untitled"}</strong><span className="small muted">{categories[record.kind]} · {state(record)}</span></button></li>)}</ul>
      </div>
      <div className="stack">
        {message && <Notice key={message} tone="ok" focus>{message}</Notice>}
        {error && <Notice tone="error" focus>{error}{Object.keys(issues).length > 0 && <ul>{Object.entries(issues).map(([key, text]) => <li key={key}><a href={`#field-${key}`}>{text}</a></li>)}</ul>}</Notice>}
        {conflict && editor && diff && <Notice tone="warn" focus title={`A newer draft (v${conflict.latest.version}) was saved by someone else. Nothing of yours was saved.`}>
          <p>Changed there: {diff.changedElsewhere.join(", ") || "none"}. Changed here: {diff.changedHere.join(", ") || "none"}.{diff.overlapping.length ? ` Both changed: ${diff.overlapping.join(", ")}.` : ""}</p>
          <div className="row"><button className="button primary small" onClick={() => { setEditor({ ...editor, version: conflict.latest.version, fields: rebaseDraft(conflict.base.fields, editor.fields, conflict.latest.fields) }); setConflict(undefined); setDirty(true); }}>Keep my edits on v{conflict.latest.version}</button>
            <button className="button secondary small" onClick={() => { setEditor({ id: conflict.latest.id, kind: conflict.latest.kind, version: conflict.latest.version, fields: { ...blank(conflict.latest.kind), ...conflict.latest.fields } }); setConflict(undefined); setDirty(false); }}>Load v{conflict.latest.version} and discard mine</button></div>
        </Notice>}
        {!editor ? <div className="empty"><h2>Select a record</h2><p>Choose a record on the left, or create a new one. Saving keeps a draft; tourists only see a record after you publish it.</p></div>
          : <form className="panel stack" onSubmit={(event) => { event.preventDefault(); void save(); }} aria-label={`Edit ${categories[editor.kind]}`}>
            <div className="spread"><h2 style={{ margin: 0 }}>{editor.id ? editor.fields.title || "Untitled" : `New ${categories[editor.kind].toLowerCase()}`}</h2>
              <span className="badge neutral">{categories[editor.kind]}{current ? ` · ${state(current)}` : " · not saved"}{dirty ? " · unsaved changes" : ""}</span></div>
            <div className="editor-grid">{fieldSpecs(editor.kind).map((spec) => <FieldInput key={spec.key} spec={spec} kind={editor.kind} fields={editor.fields} issues={issues} records={records ?? []} onChange={edit} />)}</div>
            <div className="row">
              <button className="button secondary" disabled={busy || Boolean(conflict)}><Save size={16} aria-hidden="true" />Save draft</button>
              <button type="button" className="button primary" disabled={busy || dirty || !editor.id || Boolean(conflict)} onClick={publish}><Send size={16} aria-hidden="true" />Publish</button>
              {current?.publishedVersion !== null && current && (!confirmWithdraw
                ? <button type="button" className="button ghost" disabled={busy} onClick={() => setConfirmWithdraw(true)}><Undo2 size={16} aria-hidden="true" />Withdraw…</button>
                : <span className="row"><button type="button" className="button danger small" onClick={withdraw}>Confirm withdrawal</button><button type="button" className="button ghost small" onClick={() => setConfirmWithdraw(false)}>Cancel</button></span>)}
            </div>
            {dirty && editor.id && <p className="small muted" style={{ margin: 0 }}>Save the draft before publishing.</p>}
          </form>}
        {history && <div className="panel"><h2 style={{ fontSize: 18 }}><History size={18} aria-hidden="true" /> History</h2>
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{history.map((entry, index) => <li key={index}>{entry.action === "create" ? "Created" : entry.action === "save" ? "Saved" : entry.action === "publish" ? "Published" : "Withdrew"} v{entry.version} by {entry.actor ?? "content import"} · {formatDay(entry.at.slice(0, 10), false)} {entry.at.slice(11, 16)} UTC</li>)}</ol></div>}
      </div>
    </div>}
  </div>;
}
