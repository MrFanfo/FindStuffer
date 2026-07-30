import { FormEvent, useState } from "react";

export function LoginView({
  onLogin,
}: {
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
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
        <p>Sign in once on this device. Your secure session stays available to the installed app for 90 days.</p>
        <form className="form-card compact-form" onSubmit={submit}>
          <label>Username<input required autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>Password<input required autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="primary wide" disabled={submitting || !username.trim() || !password}>{submitting ? "Signing in…" : "Sign in"}</button>
        </form>
        <small>The password stays on this device and is sent only to your Findstuff server. Use the private HTTPS address when signing in from a phone.</small>
      </section>
    </main>
  );
}
