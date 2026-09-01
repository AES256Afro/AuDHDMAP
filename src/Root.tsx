import { FormEvent, useEffect, useState } from "react";
import { loadWorkspace, login, session } from "./api";
import type { Workspace } from "./model";
import { WorkspaceApp } from "./WorkspaceApp";

type RootState =
  | { kind: "loading" }
  | { kind: "login"; error?: string }
  | { kind: "ready"; workspace: Workspace; username: string }
  | { kind: "error"; message: string };

export function Root() {
  const [state, setState] = useState<RootState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    session().then(async (current) => {
      if (!active) return;
      if (!current.authenticated || !current.username) return setState({ kind: "login" });
      const workspace = await loadWorkspace();
      if (active) setState({ kind: "ready", workspace, username: current.username! });
    }).catch((error) => active && setState({ kind: "error", message: error.message }));
    return () => { active = false; };
  }, []);

  if (state.kind === "loading") return <div className="boot-screen"><div className="boot-mark">AuDHDMAP</div><span>Opening your workspace...</span></div>;
  if (state.kind === "error") return <div className="boot-screen error-screen"><div className="boot-mark">AuDHDMAP</div><strong>Could not open the workspace</strong><p>{state.message}</p><button onClick={() => location.reload()}>Try again</button></div>;
  if (state.kind === "login") return <LoginScreen initialError={state.error} onReady={(workspace, username) => setState({ kind: "ready", workspace, username })} />;
  return <WorkspaceApp initialWorkspace={state.workspace} username={state.username} onSignedOut={() => setState({ kind: "login" })} />;
}

function LoginScreen({ initialError, onReady }: { initialError?: string; onReady: (workspace: Workspace, username: string) => void }) {
  const [username, setUsername] = useState("owner");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await login(username, password);
      onReady(await loadWorkspace(), result.username);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not sign in."); }
    finally { setBusy(false); }
  }

  return <main className="login-screen">
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-brand"><span className="brand-network" aria-hidden="true">⌘</span><div><h1 id="login-title">AuDHDMAP</h1><p>Your maps and notes stay on this server.</p></div></div>
      <form onSubmit={submit}>
        <label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>Password<input autoComplete="current-password" autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-button" disabled={busy || !password}>{busy ? "Opening..." : "Open workspace"}</button>
      </form>
      <p className="login-help">BoxPilot shows the generated sign-in details on this app's catalog card.</p>
    </section>
  </main>;
}
