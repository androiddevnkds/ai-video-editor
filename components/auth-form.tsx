"use client";

import { FormEvent, useState } from "react";
import { Film, LoaderCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

export function AuthForm() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });

    setLoading(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    if (mode === "register" && !result.data.session) {
      setMessage("Akun dibuat. Cek email untuk konfirmasi, lalu masuk.");
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="auth-logo"><Film size={24} /></span>
        <p className="eyebrow">CLIPFLOW</p>
        <h1>{mode === "login" ? "Masuk ke workspace" : "Buat akun creator"}</h1>
        <p className="auth-copy">Upload video dan siapkan klip menarik dalam satu tempat.</p>
        <form onSubmit={submit}>
          {mode === "register" && <label>Nama<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Nama kamu" required /></label>}
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kamu@email.com" required /></label>
          <label>Password<input type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimal 6 karakter" required /></label>
          {message && <p className="auth-message">{message}</p>}
          <button type="submit" disabled={loading}>{loading && <LoaderCircle size={17} className="spin" />}{mode === "login" ? "Masuk" : "Daftar"}</button>
        </form>
        <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}>
          {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
        </button>
      </section>
    </main>
  );
}
