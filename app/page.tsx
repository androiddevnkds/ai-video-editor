"use client";

import { upload } from "@vercel/blob/client";
import {
  CheckCircle2,
  Clock3,
  Film,
  LayoutDashboard,
  Play,
  Sparkles,
  UploadCloud,
  Video,
  X,
  LogOut,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AuthForm } from "@/components/auth-form";
import { supabase } from "@/lib/supabase";

type UploadState = "idle" | "ready" | "uploading" | "done" | "error";

const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export default function Dashboard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setCheckingAuth(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setCheckingAuth(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  function chooseFile(candidate?: File) {
    setError("");
    setVideoUrl("");
    setProgress(0);
    if (!candidate) return;
    if (!VIDEO_TYPES.includes(candidate.type)) {
      setError("Format belum didukung. Gunakan MP4, MOV, WebM, atau MKV.");
      setStatus("error");
      return;
    }
    if (candidate.size > MAX_VIDEO_SIZE) {
      setError("Ukuran video maksimal 2 GB.");
      setStatus("error");
      return;
    }
    setFile(candidate);
    setStatus("ready");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
  }

  async function startUpload() {
    if (!file) return;
    setStatus("uploading");
    setProgress(0);
    setError("");
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        multipart: true,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });
      if (!user) throw new Error("Sesi login berakhir. Silakan masuk kembali.");
      const { error: databaseError } = await supabase.from("videos").insert({
        user_id: user.id,
        filename: file.name,
        original_url: blob.url,
        pathname: blob.pathname,
        content_type: file.type,
        size_bytes: file.size,
        status: "uploaded",
        progress: 100,
      });
      if (databaseError) throw new Error(`Video terunggah, tetapi pencatatan database gagal: ${databaseError.message}`);
      setVideoUrl(blob.url);
      setProgress(100);
      setStatus("done");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload gagal. Coba lagi.");
      setStatus("error");
    }
  }

  function clearFile() {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setError("");
    setVideoUrl("");
    if (inputRef.current) inputRef.current.value = "";
  }

  if (checkingAuth) return <main className="loading-screen"><span className="brand-mark"><Play size={17} fill="currentColor" /></span><p>Menyiapkan workspace…</p></main>;
  if (!user) return <AuthForm />;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Play size={17} fill="currentColor" /></span>clipflow</div>
        <nav>
          <a className="nav-item active" href="#"><LayoutDashboard size={19} /> Dashboard</a>
          <a className="nav-item" href="#upload"><Video size={19} /> Video saya</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-card"><Sparkles size={17} /><div><strong>MVP mode</strong><span>AI processing segera hadir</span></div></div>
          <div className="avatar">{(user.email?.[0] ?? "C").toUpperCase()}</div><div className="profile"><strong>{user.user_metadata.display_name ?? "Creator"}</strong><span>{user.email}</span></div>
          <button className="logout" title="Keluar" onClick={() => supabase.auth.signOut()}><LogOut size={15} /></button>
        </div>
      </aside>

      <section className="content">
        <header><div><p className="eyebrow">WORKSPACE</p><h1>Selamat datang kembali</h1><p>Upload video mentahmu. Kami akan menyiapkannya untuk diproses AI.</p></div><button className="header-button" onClick={() => inputRef.current?.click()}><UploadCloud size={18} /> Upload video</button></header>

        <div className="stats">
          <article><span className="stat-icon violet"><Film size={20} /></span><div><p>Total video</p><strong>{status === "done" ? 1 : 0}</strong></div></article>
          <article><span className="stat-icon amber"><Clock3 size={20} /></span><div><p>Sedang diproses</p><strong>{status === "uploading" ? 1 : 0}</strong></div></article>
          <article><span className="stat-icon green"><CheckCircle2 size={20} /></span><div><p>Siap diedit</p><strong>{status === "done" ? 1 : 0}</strong></div></article>
        </div>

        <section className="upload-panel" id="upload">
          <div className="section-heading"><div><h2>Upload video baru</h2><p>Mulai dengan video mentah dari perangkatmu.</p></div><span className="secure">● Penyimpanan aman</span></div>

          <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska" onChange={handleInput} hidden />

          {!file ? (
            <div className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} onClick={() => inputRef.current?.click()}>
              <span className="upload-icon"><UploadCloud size={28} /></span>
              <h3>Tarik dan lepas videomu di sini</h3>
              <p>atau klik untuk memilih dari perangkat</p>
              <button>Pilih video</button>
              <small>MP4, MOV, WebM, atau MKV · Maksimal 2 GB</small>
            </div>
          ) : (
            <div className="file-card">
              <div className="file-icon"><Film size={27} /></div>
              <div className="file-info"><strong>{file.name}</strong><span>{formatBytes(file.size)} · {file.type.replace("video/", "").toUpperCase()}</span></div>
              {status !== "uploading" && <button className="remove" aria-label="Hapus video" onClick={clearFile}><X size={18} /></button>}
              {(status === "uploading" || status === "done") && <div className="progress-row"><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><b>{progress}%</b></div>}
              {status === "done" && <div className="success"><CheckCircle2 size={17} /> Upload selesai. Video siap diproses.</div>}
              {videoUrl && <a className="video-link" href={videoUrl} target="_blank" rel="noreferrer">Buka video</a>}
            </div>
          )}

          {error && <p className="error-message">{error}</p>}
          {file && status !== "uploading" && status !== "done" && <button className="upload-action" onClick={startUpload}><UploadCloud size={18} /> Mulai upload</button>}
        </section>

        <section className="workflow"><p>Yang terjadi setelah upload</p><div><span><b>1</b> Video tersimpan</span><i /> <span><b>2</b> AI mencari highlight</span><i /> <span><b>3</b> Review & download</span></div></section>
      </section>
    </main>
  );
}
