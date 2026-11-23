import { useEffect, useState, type FormEvent } from "react";
import { Download, KeyRound, LogOut, ShieldCheck, Trash2, UserRound } from "lucide-react";

import { api, errorMessage, RequestError } from "../../lib/api";
import type { Account, Fields } from "../../shared/contracts";
import { Link, navigate, useLocation } from "../router";
import { isStaff, useSession } from "../session";
import { formatDay, Loading, Notice, useTitle } from "../ui";

type Issues = Fields | undefined;
const fieldError = (issues: Issues, key: string) => issues?.[key] ? <p className="field-error" id={`${key}-error`}>{issues[key]}</p> : null;
const invalid = (issues: Issues, key: string) => issues?.[key] ? { "aria-invalid": true as const, "aria-describedby": `${key}-error` } : {};

function landing(account: Account, next: string | null) {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return isStaff(account) ? "/staff" : "/trips";
}

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const downloadCodes = () => {
    const url = URL.createObjectURL(new Blob([`STIS recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url; link.download = "stis-recovery-codes.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="panel stack" role="region" aria-labelledby="codes-title">
    <h2 id="codes-title" style={{ margin: 0 }}>Save your recovery codes</h2>
    <Notice tone="warn" focus>These codes are the only way to recover your account if you forget your password. Each works once. STIS will not show them again.</Notice>
    <div className="codes" aria-label="Recovery codes">{codes.map((code) => <span key={code}>{code}</span>)}</div>
    <div className="row"><button className="button secondary" onClick={downloadCodes}><Download size={16} aria-hidden="true" />Download as text</button>
      <button className="button secondary" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copy</button></div>
    <label className="checkbox"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />I have saved these codes somewhere safe</label>
    <div><button className="button primary" disabled={!saved} onClick={onDone}>Continue</button></div>
  </div>;
}

export function SignInPage() {
  const { account, setAccount } = useSession();
  const { search } = useLocation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useTitle("Sign in");
  useEffect(() => { if (account) navigate(landing(account, search.get("next")), { replace: true }); }, [account, search]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const { account: signedIn } = await api<{ account: Account }>("auth/login", { method: "POST", body: { email: form.get("email"), password: form.get("password") } });
      setAccount(signedIn);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <div className="stack" style={{ maxWidth: 460, marginInline: "auto" }}>
    <div><p className="eyebrow"><UserRound size={16} aria-hidden="true" />Account</p><h1>Sign in</h1>
      <p className="muted">Tourists and STIS staff sign in here.</p></div>
    {error && <Notice tone="error" focus>{error}</Notice>}
    <form className="panel stack" onSubmit={submit}>
      <label className="field">Email<input type="email" name="email" required autoComplete="username" maxLength={254} /></label>
      <label className="field">Password<input type="password" name="password" required autoComplete="current-password" maxLength={200} /></label>
      <div className="spread"><button className="button primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button><Link to="/account/recover">Forgot your password?</Link></div>
    </form>
    <p>New to STIS? <Link to="/account/register">Create an account</Link> or <Link to="/trips">plan as a guest</Link>.</p>
  </div>;
}

export function RegisterPage() {
  const { setAccount } = useSession();
  const [issues, setIssues] = useState<Issues>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[]>();
  const [pending, setPending] = useState<Account>();
  useTitle("Create an account");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirm")) { setIssues({ confirm: "The passwords do not match." }); return; }
    setBusy(true); setError(""); setIssues(undefined);
    try {
      const result = await api<{ account: Account; recoveryCodes: string[] }>("auth/register", { method: "POST",
        body: { displayName: form.get("displayName"), email: form.get("email"), password: form.get("password") } });
      setPending(result.account); setCodes(result.recoveryCodes);
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof RequestError) setIssues(cause.issues);
    } finally { setBusy(false); }
  }
  if (codes) return <div style={{ maxWidth: 640, marginInline: "auto" }}><RecoveryCodes codes={codes} onDone={() => { setAccount(pending ?? null); navigate("/trips"); }} /></div>;
  return <div className="stack" style={{ maxWidth: 520, marginInline: "auto" }}>
    <div><p className="eyebrow"><UserRound size={16} aria-hidden="true" />Account</p><h1>Create an account</h1>
      <p className="muted">An account keeps your trips across devices. STIS stores your email address, display name and trips, nothing else. You can delete your account at any time.</p></div>
    {error && <Notice tone="error" focus>{error}</Notice>}
    <form className="panel stack" onSubmit={submit} noValidate>
      <label className="field">Display name<input type="text" name="displayName" required maxLength={60} autoComplete="nickname" {...invalid(issues, "displayName")} />{fieldError(issues, "displayName")}</label>
      <label className="field">Email<input type="email" name="email" required maxLength={254} autoComplete="email" {...invalid(issues, "email")} />{fieldError(issues, "email")}</label>
      <label className="field">Password <small>10 to 200 characters. A passphrase of several words works well.</small>
        <input type="password" name="password" required minLength={10} maxLength={200} autoComplete="new-password" {...invalid(issues, "password")} />{fieldError(issues, "password")}</label>
      <label className="field">Confirm password<input type="password" name="confirm" required maxLength={200} autoComplete="new-password" {...invalid(issues, "confirm")} />{fieldError(issues, "confirm")}</label>
      <div><button className="button primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button></div>
    </form>
    <p>Already have an account? <Link to="/account/sign-in">Sign in</Link></p>
  </div>;
}

export function RecoverPage() {
  const { setAccount } = useSession();
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ account: Account; remaining: number }>();
  const [busy, setBusy] = useState(false);
  useTitle("Recover your account");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("newPassword") !== form.get("confirm")) { setError("The new passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ account: Account; recoveryCodesRemaining: number }>("auth/recover", { method: "POST",
        body: { email: form.get("email"), code: form.get("code"), newPassword: form.get("newPassword") } });
      setDone({ account: result.account, remaining: result.recoveryCodesRemaining });
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  if (done) return <div className="stack" style={{ maxWidth: 520, marginInline: "auto" }}>
    <Notice tone="ok" focus title="Your password has been reset and you are signed in.">
      <p>All other sessions were signed out. You have {done.remaining} recovery code{done.remaining === 1 ? "" : "s"} left{done.remaining <= 3 ? "; generate new ones from your account page" : ""}.</p></Notice>
    <div><button className="button primary" onClick={() => { setAccount(done.account); navigate("/account"); }}>Go to my account</button></div></div>;
  return <div className="stack" style={{ maxWidth: 520, marginInline: "auto" }}>
    <div><p className="eyebrow"><KeyRound size={16} aria-hidden="true" />Account recovery</p><h1>Recover your account</h1>
      <p className="muted">Use one of the recovery codes you saved when you created your account.</p></div>
    {error && <Notice tone="error" focus>{error}</Notice>}
    <form className="panel stack" onSubmit={submit}>
      <label className="field">Email<input type="email" name="email" required autoComplete="username" maxLength={254} /></label>
      <label className="field">Recovery code<input type="text" name="code" required autoComplete="one-time-code" placeholder="xxxx-xxxx-xxxx-xxxx" maxLength={64} spellCheck={false} /></label>
      <label className="field">New password<input type="password" name="newPassword" required minLength={10} maxLength={200} autoComplete="new-password" /></label>
      <label className="field">Confirm new password<input type="password" name="confirm" required maxLength={200} autoComplete="new-password" /></label>
      <div><button className="button primary" disabled={busy}>Reset password</button></div>
    </form>
    <p className="small muted">Lost your codes too? Staff accounts can be reset by an STIS administrator. Tourist accounts without codes cannot be recovered, so create a new account.</p>
  </div>;
}

export function ProfilePage() {
  const { account, setAccount, signOut } = useSession();
  const [profile, setProfile] = useState<Account & { recoveryCodesRemaining: number }>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[]>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  useTitle("My account");
  useEffect(() => {
    if (account === null) navigate("/account/sign-in?next=/account", { replace: true });
    if (account) void api<Account & { recoveryCodesRemaining: number }>("account").then(setProfile).catch((cause) => setError(errorMessage(cause)));
  }, [account]);
  async function run(event: FormEvent<HTMLFormElement>, path: string, method: string, feedback: string, after?: (result: never) => void) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage(""); setError("");
    try {
      const result = await api<never>(path, { method, body: Object.fromEntries(new FormData(form)) });
      setMessage(feedback); form.reset(); after?.(result);
    } catch (cause) { setError(errorMessage(cause)); }
  }
  if (!account || !profile) return error ? <Notice tone="error">{error}</Notice> : <Loading />;
  if (codes) return <div style={{ maxWidth: 640 }}><RecoveryCodes codes={codes} onDone={() => { setCodes(undefined); setProfile({ ...profile, recoveryCodesRemaining: codes.length }); }} /></div>;
  return <div className="stack" style={{ maxWidth: 760 }}>
    <div className="spread"><div><p className="eyebrow"><UserRound size={16} aria-hidden="true" />Account</p><h1 style={{ margin: 0 }}>{profile.displayName}</h1>
      <p className="muted">{profile.email} · {profile.role === "tourist" ? "Tourist" : profile.role === "admin" ? "Administrator" : "Staff"} · member since {formatDay(profile.createdAt.slice(0, 10), false)}</p></div>
      <button className="button secondary" onClick={() => signOut().then(() => navigate("/"))}><LogOut size={16} aria-hidden="true" />Sign out</button></div>
    {message && <Notice tone="ok">{message}</Notice>}
    {error && <Notice tone="error" focus>{error}</Notice>}
    <form className="panel stack" onSubmit={(event) => run(event, "account", "PATCH", "Display name updated.", (result: Account) => { setProfile({ ...profile, ...result }); setAccount({ ...account, displayName: result.displayName }); })}>
      <h2 style={{ margin: 0 }}>Profile</h2>
      <label className="field">Display name<input type="text" name="displayName" required maxLength={60} defaultValue={profile.displayName} /></label>
      <div><button className="button secondary">Save</button></div></form>
    <form className="panel stack" onSubmit={(event) => run(event, "account/password", "POST", "Password changed. Other devices were signed out.")}>
      <h2 style={{ margin: 0 }}>Change password</h2>
      <label className="field">Current password<input type="password" name="currentPassword" required autoComplete="current-password" maxLength={200} /></label>
      <label className="field">New password<input type="password" name="newPassword" required minLength={10} maxLength={200} autoComplete="new-password" /></label>
      <div><button className="button secondary">Change password</button></div></form>
    <form className="panel stack" onSubmit={(event) => run(event, "account/recovery-codes", "POST", "New recovery codes generated. The old codes no longer work.", (result: { recoveryCodes: string[] }) => setCodes(result.recoveryCodes))}>
      <h2 style={{ margin: 0 }}><ShieldCheck size={20} aria-hidden="true" /> Recovery codes</h2>
      <p className="muted" style={{ margin: 0 }}>{profile.recoveryCodesRemaining} unused code{profile.recoveryCodesRemaining === 1 ? "" : "s"} left. Generating new codes replaces all old ones.</p>
      <label className="field">Password<input type="password" name="password" required autoComplete="current-password" maxLength={200} /></label>
      <div><button className="button secondary">Generate new codes</button></div></form>
    <section className="panel stack" aria-labelledby="delete-account">
      <h2 id="delete-account" style={{ margin: 0 }}>Delete account</h2>
      <p className="muted" style={{ margin: 0 }}>This permanently removes your account and every trip saved to it.</p>
      {!confirmDelete ? <div><button className="button ghost" onClick={() => setConfirmDelete(true)}><Trash2 size={16} aria-hidden="true" />Delete my account…</button></div>
        : <form className="stack" onSubmit={(event) => run(event, "account/delete", "POST", "", () => { setAccount(null); navigate("/"); })}>
          <label className="field">Confirm with your password<input type="password" name="password" required autoComplete="current-password" maxLength={200} /></label>
          <div className="row"><button className="button danger">Delete permanently</button><button type="button" className="button ghost" onClick={() => setConfirmDelete(false)}>Cancel</button></div></form>}
    </section>
  </div>;
}
