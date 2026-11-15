import { readFile } from "node:fs/promises";
import { join } from "node:path";

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function analyseImpactAudio(raw, sampleRate = 16000) {
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const frameSeconds = 0.02;
  const frameSamples = Math.round(sampleRate * frameSeconds);
  const levels = [];
  const peaks = [];
  for (let offset = 0; offset + frameSamples <= samples.length; offset += frameSamples) {
    let sum = 0;
    let peak = 0;
    for (let index = offset; index < offset + frameSamples; index += 1) {
      const value = Math.abs(samples[index]);
      sum += value * value;
      if (value > peak) peak = value;
    }
    levels.push(20 * Math.log10(Math.sqrt(sum / frameSamples) + 1e-7));
    peaks.push(peak);
  }
  const floor = median(levels);
  const deviation = median(levels.map((level) => Math.abs(level - floor)));
  // Audio proposes candidate windows; ball-motion validation makes the final
  // decision. Keep this sensitive enough to retain softer/far-court impacts.
  const threshold = Math.max(floor + 10, floor + deviation * 4.25);
  const impacts = [];
  const localRadius = 5;
  // Indoor courts create a short, loud echo after a racket impact. Treat peaks
  // within this window as the same stroke instead of inflating the hit count.
  const cooldownFrames = Math.round(0.55 / frameSeconds);
  for (let index = localRadius; index < levels.length - localRadius; index += 1) {
    if (levels[index] < threshold || peaks[index] < 0.035) continue;
    let localMaximum = true;
    for (let nearby = index - localRadius; nearby <= index + localRadius; nearby += 1) {
      if (levels[nearby] > levels[index]) { localMaximum = false; break; }
    }
    if (!localMaximum) continue;
    const previousFrame = impacts.length ? Math.round(impacts.at(-1).time / frameSeconds) : -Infinity;
    if (index - previousFrame < cooldownFrames) continue;
    impacts.push({ time: index * frameSeconds, strength: levels[index] - floor });
  }
  return { impacts, noiseFloorDb: floor, thresholdDb: threshold };
}

function buildRallies(impacts, duration) {
  const groups = [];
  let current = [];
  for (const impact of impacts) {
    // Preserve long lobs and brief occlusions inside the same point.
    if (!current.length || impact.time - current.at(-1).time <= 4.4) current.push(impact);
    else { if (current.length >= 2) groups.push(current); current = [impact]; }
  }
  if (current.length >= 2) groups.push(current);
  return groups.filter((group) => group.slice(1).some((impact, index) => {
    const gap = impact.time - group[index].time;
    return gap >= 0.35 && gap <= 2.8;
  })).map((group, index) => ({
    start: Math.max(0, group[0].time - 1.5),
    end: Math.min(duration, group.at(-1).time + 5.0),
    score: Math.min(95, 55 + group.length * 5),
    title: `Tennis rally ${index + 1}`,
    reason: `${group.length} kandidat pukulan terdeteksi dari pola impact audio.`,
    hitCount: group.length,
    impactTimes: group.map((impact) => impact.time),
  })).filter((rally) => rally.end - rally.start >= 3);
}

function analyseCourtMotion(raw, width = 160, height = 90, fps = 10) {
  const frameSize = width * height;
  const frameCount = Math.floor(raw.byteLength / frameSize);
  const motion = [{ time: 0, score: 0 }];
  // Ignore the roof/upper wall; court and players occupy the lower 78% in the
  // supplied fixed-camera footage.
  const firstRow = Math.floor(height * 0.22);
  for (let frame = 1; frame < frameCount; frame += 1) {
    const previous = (frame - 1) * frameSize;
    const current = frame * frameSize;
    let changed = 0;
    let compared = 0;
    for (let y = firstRow; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const difference = Math.abs(raw[current + index] - raw[previous + index]);
        if (difference >= 12) changed += difference;
        compared += 1;
      }
    }
    motion.push({ time: frame / fps, score: changed / compared });
  }
  const scores = motion.map((item) => item.score);
  const baseline = median(scores);
  const deviation = median(scores.map((score) => Math.abs(score - baseline)));
  return { motion, baseline, highMotion: baseline + deviation * 2 };
}

function applyVisualValidation(highlights, visual) {
  return highlights.map((highlight) => {
    const frames = visual.motion.filter((item) => item.time >= highlight.start && item.time <= highlight.end);
    const activeRatio = frames.length ? frames.filter((item) => item.score >= visual.highMotion).length / frames.length : 0;
    const averageMotion = frames.length ? frames.reduce((sum, item) => sum + item.score, 0) / frames.length : 0;
    const visuallyActive = activeRatio >= 0.08 || averageMotion >= visual.baseline * 1.35;
    return {
      ...highlight,
      visuallyActive,
      activeRatio,
      averageMotion,
      score: Math.max(1, Math.min(99, highlight.score + (visuallyActive ? 8 : -25))),
      reason: visuallyActive
        ? `${highlight.hitCount} kandidat pukulan dengan aktivitas visual di lapangan.`
        : `${highlight.hitCount} kandidat impact, tetapi aktivitas visual rendah.`,
    };
  });
}

export async function detectTennisHighlights({ source, workdir, ffmpegPath, run, duration }) {
  const audioPath = join(workdir, "tennis-impact-audio.f32le");
  const videoPath = join(workdir, "tennis-motion.gray");
  await run(ffmpegPath, ["-y", "-i", source, "-vn", "-af", "highpass=f=1200,lowpass=f=7000", "-ac", "1", "-ar", "16000", "-f", "f32le", audioPath], workdir);
  await run(ffmpegPath, ["-y", "-i", source, "-an", "-vf", "fps=10,scale=160:90,format=gray", "-f", "rawvideo", videoPath], workdir);
  const diagnostics = analyseImpactAudio(await readFile(audioPath));
  const visual = analyseCourtMotion(await readFile(videoPath));
  const audioHighlights = buildRallies(diagnostics.impacts, duration);
  const highlights = applyVisualValidation(audioHighlights, visual);
  return { highlights, diagnostics: { ...diagnostics, visualBaseline: visual.baseline, visualThreshold: visual.highMotion, audioCandidateCount: audioHighlights.length } };
}

export { analyseImpactAudio, analyseCourtMotion, applyVisualValidation, buildRallies };
