import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { get, put } from "@vercel/blob";
import { createClient } from "@supabase/supabase-js";
import { pipeline as createPipeline } from "@huggingface/transformers";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import OpenAI from "openai";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BLOB_READ_WRITE_TOKEN"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const aiProvider = process.env.AI_PROVIDER || "local";
if (aiProvider === "openai" && !process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai");
const openai = aiProvider === "openai" ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const highlightModel = process.env.OPENAI_HIGHLIGHT_MODEL || "gpt-6-luna";
const localWhisperModel = process.env.LOCAL_WHISPER_MODEL || "Xenova/whisper-small";
const pollInterval = Number(process.env.WORKER_POLL_INTERVAL_MS || 5000);
const ffprobePath = ffprobeStatic.path;
let localTranscriber;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}: ${stderr.slice(-2000)}`)));
  });
}

async function ffprobeDuration(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input], { windowsHide: true });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { error += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(Number(output.trim())) : reject(new Error(error)));
  });
}

async function updateJob(id, status, progress, stage_message, extra = {}) {
  const { error } = await supabase.from("processing_jobs").update({ status, progress, stage_message, updated_at: new Date().toISOString(), ...extra }).eq("id", id);
  if (error) throw error;
}

async function claimJob() {
  const { data: job, error } = await supabase
    .from("processing_jobs")
    .select("id, video_id, user_id, videos!inner(filename, pathname, content_type)")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!job) return null;

  const { data: claimed, error: claimError } = await supabase
    .from("processing_jobs")
    .update({ status: "downloading", progress: 3, stage_message: "Mengunduh video", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  return claimed ? job : null;
}

async function transcribeChunksOpenAI(directory) {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".mp3")).sort();
  const segments = [];
  let offset = 0;

  for (let index = 0; index < files.length; index += 1) {
    const path = join(directory, files[index]);
    const duration = await ffprobeDuration(path);
    const transcript = await openai.audio.transcriptions.create({
      file: createReadStream(path),
      model: "gpt-transcribe",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });

    if (Array.isArray(transcript.segments) && transcript.segments.length) {
      for (const segment of transcript.segments) {
        segments.push({ start: offset + Number(segment.start), end: offset + Number(segment.end), text: segment.text.trim() });
      }
    } else if (transcript.text?.trim()) {
      segments.push({ start: offset, end: offset + duration, text: transcript.text.trim() });
    }
    offset += duration;
  }
  return segments;
}

async function transcribeChunksLocal(directory) {
  if (!localTranscriber) {
    console.log(`Loading local speech model ${localWhisperModel}. The first run downloads the model once.`);
    localTranscriber = await createPipeline("automatic-speech-recognition", localWhisperModel, { dtype: "q8" });
  }
  const files = (await readdir(directory)).filter((name) => name.endsWith(".mp3")).sort();
  const segments = [];
  let offset = 0;
  for (const name of files) {
    const path = join(directory, name);
    const duration = await ffprobeDuration(path);
    const result = await localTranscriber(path, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, language: "indonesian", task: "transcribe" });
    if (Array.isArray(result.chunks)) {
      for (const chunk of result.chunks) {
        const [start, end] = chunk.timestamp || [0, duration];
        if (chunk.text?.trim()) segments.push({ start: offset + Number(start || 0), end: offset + Number(end || duration), text: chunk.text.trim() });
      }
    } else if (result.text?.trim()) segments.push({ start: offset, end: offset + duration, text: result.text.trim() });
    offset += duration;
  }
  return segments;
}

function chooseHighlightsLocal(segments, duration) {
  const hookWords = /\b(ternyata|rahasia|kesalahan|jangan|cara|kenapa|penting|masalah|solusi|tips|fakta|bayangkan|pertama|terbaik|terburuk)\b/gi;
  const fillerWords = /\b(eee+|emm+|anu|mungkin ya|apa namanya)\b/gi;
  const candidates = [];
  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    const start = segments[startIndex].start;
    let end = start;
    const text = [];
    for (let index = startIndex; index < segments.length; index += 1) {
      end = segments[index].end;
      text.push(segments[index].text);
      const clipDuration = end - start;
      if (clipDuration >= 30) {
        const joined = text.join(" ").trim();
        const words = joined.split(/\s+/).length;
        const hooks = (joined.match(hookWords) || []).length;
        const fillers = (joined.match(fillerWords) || []).length;
        const punctuation = (joined.match(/[?!]/g) || []).length;
        const speechDensity = words / Math.max(clipDuration, 1);
        const lengthFit = Math.max(0, 20 - Math.abs(50 - clipDuration) * 0.4);
        const score = Math.max(1, Math.min(99, Math.round(45 + lengthFit + hooks * 7 + punctuation * 2 + Math.min(12, speechDensity * 5) - fillers * 4)));
        candidates.push({ start, end: Math.min(end, duration), score, title: joined.split(/[.!?]/)[0].trim().slice(0, 90) || "Highlight pilihan", reason: hooks ? "Memiliki hook kuat dan pembahasan yang padat." : "Percakapan padat dengan sedikit jeda." });
      }
      if (clipDuration >= 70) break;
    }
  }
  const selected = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (selected.every((item) => candidate.end <= item.start || candidate.start >= item.end)) selected.push(candidate);
    if (selected.length === 3) break;
  }
  return selected.sort((a, b) => a.start - b.start);
}

async function chooseHighlights(segments, duration) {
  if (aiProvider === "local") return chooseHighlightsLocal(segments, duration);
  const compactTranscript = segments.map((item) => `[${item.start.toFixed(1)}-${item.end.toFixed(1)}] ${item.text}`).join("\n");
  const response = await openai.responses.create({
    model: highlightModel,
    instructions: "Kamu adalah editor short-form video Bahasa Indonesia. Pilih maksimal 3 klip terbaik yang bisa berdiri sendiri. Setiap klip harus 20-90 detik, dimulai dan diakhiri di batas kalimat, punya hook jelas, dan tidak melebihi durasi video. Balas JSON saja tanpa markdown: {\"clips\":[{\"start\":number,\"end\":number,\"score\":number,\"title\":string,\"reason\":string}]}",
    input: `Durasi video: ${duration.toFixed(1)} detik.\nTranscript:\n${compactTranscript}`,
  });

  const text = response.output_text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  const parsed = JSON.parse(text);
  return (parsed.clips || [])
    .map((clip) => ({
      start: Math.max(0, Number(clip.start)),
      end: Math.min(duration, Number(clip.end)),
      score: Math.max(0, Math.min(100, Number(clip.score) || 0)),
      title: String(clip.title || "AI Highlight").slice(0, 120),
      reason: String(clip.reason || "Dipilih AI").slice(0, 500),
    }))
    .filter((clip) => Number.isFinite(clip.start) && Number.isFinite(clip.end) && clip.end - clip.start >= 10 && clip.end > clip.start)
    .slice(0, 3);
}

async function processJob(job) {
  const workdir = await mkdtemp(join(tmpdir(), "clipflow-"));
  const source = join(workdir, `source-${basename(job.videos.filename)}`);
  try {
    const blob = await get(job.videos.pathname, { access: "private" });
    if (!blob || blob.statusCode !== 200) throw new Error("Video Blob tidak ditemukan");
    await pipeline(Readable.fromWeb(blob.stream), createWriteStream(source));

    await updateJob(job.id, "extracting_audio", 15, "Mengekstrak dan membagi audio");
    await run(ffmpegPath, ["-y", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", "-f", "segment", "-segment_time", "600", join(workdir, "audio-%03d.mp3")], workdir);

    await updateJob(job.id, "transcribing", 32, "Membuat transcript bertimestamp");
    const transcript = aiProvider === "local" ? await transcribeChunksLocal(workdir) : await transcribeChunksOpenAI(workdir);
    if (!transcript.length) throw new Error("Tidak ada percakapan yang berhasil ditranskripsi");

    const duration = await ffprobeDuration(source);
    await updateJob(job.id, "analyzing", 58, "AI memilih bagian paling menarik", { transcript });
    const highlights = await chooseHighlights(transcript, duration);
    if (!highlights.length) throw new Error("AI tidak menemukan klip yang memenuhi kriteria");

    await updateJob(job.id, "rendering", 70, `Memotong ${highlights.length} kandidat klip`);
    const rendered = [];
    for (let index = 0; index < highlights.length; index += 1) {
      const clip = highlights[index];
      const output = join(workdir, `highlight-${index + 1}.mp4`);
      await run(ffmpegPath, ["-y", "-ss", String(clip.start), "-to", String(clip.end), "-i", source, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output], workdir);
      rendered.push({ ...clip, output });
      await updateJob(job.id, "rendering", 70 + Math.round(((index + 1) / highlights.length) * 15), `Membuat klip ${index + 1} dari ${highlights.length}`);
    }

    await updateJob(job.id, "uploading", 88, "Mengunggah hasil klip secara privat");
    for (let index = 0; index < rendered.length; index += 1) {
      const clip = rendered[index];
      const uploaded = await put(`clips/${job.user_id}/${job.video_id}/highlight-${index + 1}.mp4`, await readFile(clip.output), { access: "private", addRandomSuffix: true, contentType: "video/mp4" });
      const { error: clipError } = await supabase.from("clips").insert({
        video_id: job.video_id,
        start_time_seconds: clip.start,
        end_time_seconds: clip.end,
        score: clip.score,
        output_url: uploaded.url,
        caption: null,
        title: clip.title,
        reason: clip.reason,
        status: "ready",
      });
      if (clipError) throw clipError;
    }

    await supabase.from("videos").update({ status: "ready", progress: 100, updated_at: new Date().toISOString() }).eq("id", job.video_id);
    await updateJob(job.id, "ready", 100, `${rendered.length} klip siap direview`, { completed_at: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("videos").update({ status: "failed", error_message: message, updated_at: new Date().toISOString() }).eq("id", job.video_id);
    await updateJob(job.id, "failed", 100, "Pemrosesan gagal", { error_message: message, completed_at: new Date().toISOString() });
    console.error(`[job ${job.id}]`, error);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

console.log(`Clipflow worker started with ${aiProvider} provider. Waiting for queued jobs...`);
while (true) {
  try {
    const job = await claimJob();
    if (job) await processJob(job);
    else await wait(pollInterval);
  } catch (error) {
    console.error("Worker loop error:", error);
    await wait(pollInterval);
  }
}
