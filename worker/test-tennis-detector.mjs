import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { detectTennisHighlights } from "./tennis-detector.mjs";

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
}

function durationOf(source) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobeStatic.path, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source], { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => code === 0 ? resolve(Number(output.trim())) : reject(new Error("ffprobe failed")));
  });
}

for (const input of process.argv.slice(2)) {
  const source = resolve(input);
  const workdir = await mkdtemp(join(tmpdir(), "tennis-detector-test-"));
  const duration = await durationOf(source);
  const result = await detectTennisHighlights({ source, workdir, ffmpegPath, run, duration });
  console.log(JSON.stringify({ source, duration, diagnostics: { ...result.diagnostics, impacts: undefined }, highlights: result.highlights }, null, 2));
}
