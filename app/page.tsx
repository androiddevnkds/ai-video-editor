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
  Download,
  Eye,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AuthForm } from "@/components/auth-form";
import { supabase } from "@/lib/supabase";

type UploadState = "idle" | "ready" | "uploading" | "done" | "error";
type FileAction = { id: string; kind: "preview" | "download"; progress: number } | null;
type VideoRecord = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: "uploaded" | "queued" | "processing" | "ready" | "failed";
  progress: number;
  created_at: string;
};

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
  const [dragging, setDragging] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [actionId, setActionId] = useState("");
  const [fileAction, setFileAction] = useState<FileAction>(null);
  const [preview, setPreview] = useState<{ url: string; filename: string } | null>(null);

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

  useEffect(() => {
    if (!user) return;
    setLoadingVideos(true);
    supabase
      .from("videos")
      .select("id, filename, content_type, size_bytes, status, progress, created_at")
      .order("created_at", { ascending: false })
      .then(({ data, error: loadError }) => {
        setVideoError(loadError?.message ?? "");
        setVideos((data as VideoRecord[] | null) ?? []);
        setLoadingVideos(false);
      });
  }, [user]);

  function chooseFile(candidate?: File) {
    setError("");
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
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Sesi login berakhir. Silakan masuk kembali.");
      const blob = await upload(file.name, file, {
        access: "private",
        handleUploadUrl: "/api/upload",
        clientPayload: sessionData.session.access_token,
        multipart: true,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });
      if (!user) throw new Error("Sesi login berakhir. Silakan masuk kembali.");
      const { data: createdVideo, error: databaseError } = await supabase.from("videos").insert({
        user_id: user.id,
        filename: file.name,
        original_url: blob.url,
        pathname: blob.pathname,
        content_type: file.type,
        size_bytes: file.size,
        status: "uploaded",
        progress: 100,
      }).select("id, filename, content_type, size_bytes, status, progress, created_at").single();
      if (databaseError) throw new Error(`Video terunggah, tetapi pencatatan database gagal: ${databaseError.message}`);
      setVideos((current) => [createdVideo as VideoRecord, ...current]);
      setProgress(100);
      setStatus("done");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload gagal. Coba lagi.");
      setStatus("error");
    }
  }

  async function authorizedVideoRequest(video: VideoRecord, download = false) {
    setActionId(video.id);
    setFileAction({ id: video.id, kind: download ? "download" : "preview", progress: 0 });
    setVideoError("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sesi login berakhir.");
      const response = await fetch(`/api/videos/${video.id}${download ? "?download=1" : ""}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Gagal mengambil video.");
      if (!response.body) throw new Error("Browser tidak mendukung progress download.");

      const totalBytes = Number(response.headers.get("content-length")) || video.size_bytes;
      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.byteLength;
        const percentage = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0;
        setFileAction({ id: video.id, kind: download ? "download" : "preview", progress: percentage });
      }

      setFileAction({ id: video.id, kind: download ? "download" : "preview", progress: 100 });
      const objectUrl = URL.createObjectURL(new Blob(chunks, { type: response.headers.get("content-type") ?? video.content_type }));
      if (download) {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = video.filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      } else {
        setPreview({ url: objectUrl, filename: video.filename });
      }
    } catch (requestError) {
      setVideoError(requestError instanceof Error ? requestError.message : "Aksi gagal.");
    } finally {
      setActionId("");
      setFileAction(null);
    }
  }

  async function deleteVideo(video: VideoRecord) {
    if (!window.confirm(`Hapus ${video.filename}? File ini tidak dapat dipulihkan.`)) return;
    setActionId(video.id);
    setVideoError("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Sesi login berakhir.");
      const response = await fetch(`/api/videos/${video.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Gagal menghapus video.");
      setVideos((current) => current.filter((item) => item.id !== video.id));
    } catch (deleteError) {
      setVideoError(deleteError instanceof Error ? deleteError.message : "Gagal menghapus video.");
    } finally {
      setActionId("");
    }
  }

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  function clearFile() {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setError("");
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
          <a className="nav-item" href="#videos"><Video size={19} /> Video saya</a>
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
          <article><span className="stat-icon violet"><Film size={20} /></span><div><p>Total video</p><strong>{videos.length}</strong></div></article>
          <article><span className="stat-icon amber"><Clock3 size={20} /></span><div><p>Sedang diproses</p><strong>{videos.filter((video) => video.status === "processing" || video.status === "queued").length}</strong></div></article>
          <article><span className="stat-icon green"><CheckCircle2 size={20} /></span><div><p>Sudah terupload</p><strong>{videos.filter((video) => video.status === "uploaded" || video.status === "ready").length}</strong></div></article>
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
              {status === "done" && <span className="private-note">Tersimpan privat · hanya akunmu yang dapat mengakses</span>}
            </div>
          )}

          {error && <p className="error-message">{error}</p>}
          {file && status !== "uploading" && status !== "done" && <button className="upload-action" onClick={startUpload}><UploadCloud size={18} /> Mulai upload</button>}
        </section>

        <section className="workflow"><p>Yang terjadi setelah upload</p><div><span><b>1</b> Video tersimpan</span><i /> <span><b>2</b> AI mencari highlight</span><i /> <span><b>3</b> Review & download</span></div></section>

        <section className="library-panel" id="videos">
          <div className="section-heading"><div><h2>Video saya</h2><p>File privat yang tersimpan di workspace ini.</p></div><span className="video-count">{videos.length} video</span></div>
          {videoError && <p className="error-message">{videoError}</p>}
          {loadingVideos ? (
            <div className="library-empty"><LoaderCircle className="spin" size={22} /> Memuat video…</div>
          ) : videos.length === 0 ? (
            <div className="library-empty"><Film size={28} /><strong>Belum ada video</strong><span>Upload video pertamamu untuk mulai.</span></div>
          ) : (
            <div className="video-list">
              {videos.map((video) => (
                <article className="video-row" key={video.id}>
                  <span className="video-file-icon"><Film size={21} /></span>
                  <div className="video-meta"><strong>{video.filename}</strong><span>{formatBytes(video.size_bytes)} · {new Date(video.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</span></div>
                  <span className={`status-badge ${video.status}`}>{video.status === "uploaded" ? "Terupload" : video.status}</span>
                  <div className="video-actions">
                    <button title="Preview" disabled={actionId === video.id} onClick={() => authorizedVideoRequest(video)}>{actionId === video.id ? <LoaderCircle className="spin" size={16} /> : <Eye size={16} />}</button>
                    <button title="Download" disabled={actionId === video.id} onClick={() => authorizedVideoRequest(video, true)}><Download size={16} /></button>
                    <button className="danger" title="Hapus" disabled={actionId === video.id} onClick={() => deleteVideo(video)}><Trash2 size={16} /></button>
                  </div>
                  {fileAction?.id === video.id && (
                    <div className="file-action-progress">
                      <div><span>{fileAction.kind === "preview" ? "Menyiapkan preview" : "Mengunduh video"}</span><b>{fileAction.progress}%</b></div>
                      <div className="progress-track"><span style={{ width: `${fileAction.progress}%` }} /></div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
      {preview && <div className="modal-backdrop" onClick={closePreview}><div className="video-modal" onClick={(event) => event.stopPropagation()}><div><strong>{preview.filename}</strong><button onClick={closePreview}><X size={18} /></button></div><video src={preview.url} controls autoPlay /></div></div>}
    </main>
  );
}
