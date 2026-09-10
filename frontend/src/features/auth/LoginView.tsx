import { FormEvent, useState } from "react";

export function LoginView({
  onLogin,
}: {
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onLogin(username.trim(), password);
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Could not sign in",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark" aria-hidden="true">F</div>
        <p className="eyebrow">PRIVATE INVENTORY</p>
        <h1>Welcome to Findstuff</h1>
        <p>Sign in to your private inventory. This device stays signed in for up to 90 days.</p>
        <form className="form-card compact-form" onSubmit={submit}>
          <label>Username<input required autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>Password<input required autoComplete="current-password" type={showPassword ? "text" : "password"} onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide password" : "Show password"}</button>
          {capsLock && <p role="status">Caps Lock is on.</p>}
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="primary wide" disabled={submitting || !username.trim() || !password}>{submitting ? "Signing in…" : "Sign in"}</button>
        </form>
        <details><summary>Forgot your password?</summary><p>Ask the person who runs this Findstuff server to recover or reset the saved administrator password. A password saved by Findstuff takes priority over the initial setup password.</p></details><small>Use your private HTTPS address when signing in from another device.</small>
      </section>
    </main>
  );
}
