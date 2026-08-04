import {execFileSync} from "node:child_process";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {KokoroTTS} from "kokoro-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const scenesPath = path.join(root, "content", "episodes", "sixty60", "scenes.json");
const segmentDir = path.join(root, "public", "audio", "sixty60");
const audioPath = path.join(root, "public", "audio", "sixty60-pilot.wav");
const timingPath = path.join(root, "src", "data", "sixty60-timings.json");
const captionDir = path.join(root, "public", "captions");
const captionPath = path.join(captionDir, "sixty60-pilot.srt");
const voice = process.env.KOKORO_VOICE ?? "af_heart";
const speechSpeed = Number(process.env.KOKORO_SPEED ?? "0.96");
const scenePauseSeconds = Number(process.env.PILOT_SCENE_PAUSE ?? "0.65");
const finalHoldSeconds = Number(process.env.PILOT_FINAL_HOLD ?? "1.5");
const fps = 30;

const scenes = JSON.parse(await readFile(scenesPath, "utf8"));
await mkdir(segmentDir, {recursive: true});
await mkdir(path.dirname(timingPath), {recursive: true});
await mkdir(captionDir, {recursive: true});

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
  dtype: "q8",
  device: "cpu",
});

const probeDuration = (file) =>
  Number(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      {encoding: "utf8"},
    ).trim(),
  );

const speechFiles = [];
for (const [index, scene] of scenes.entries()) {
  const file = path.join(segmentDir, `${String(index + 1).padStart(2, "0")}-${scene.id}.wav`);
  const audio = await tts.generate(scene.narration, {voice, speed: speechSpeed});
  await audio.save(file);
  speechFiles.push(file);
  process.stdout.write(`Generated ${scene.id}\n`);
}

// Treat every chapter boundary as an edit, rather than placing two generated
// waveforms directly against one another. A short fade protects consonants at
// the join and the padded room tone gives the viewer a deliberate breath.
const editedFiles = [];
const narrationDurations = [];
for (const [index, file] of speechFiles.entries()) {
  const speechDuration = probeDuration(file);
  const pauseDuration = index === speechFiles.length - 1 ? finalHoldSeconds : scenePauseSeconds;
  const editedFile = path.join(segmentDir, `${String(index + 1).padStart(2, "0")}-${scenes[index].id}-edited.wav`);
  const fadeOutDuration = Math.min(0.08, speechDuration / 2);
  const fadeOutStart = Math.max(0, speechDuration - fadeOutDuration);

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      file,
      "-af",
      `afade=t=in:st=0:d=0.04,afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration},apad=pad_dur=${pauseDuration}`,
      "-t",
      String(speechDuration + pauseDuration),
      "-ar",
      "48000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      editedFile,
    ],
    {stdio: "inherit"},
  );

  narrationDurations.push(speechDuration);
  editedFiles.push(editedFile);
}

const concatPath = path.join(segmentDir, "concat.txt");
await writeFile(
  concatPath,
  editedFiles.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"),
  "utf8",
);

execFileSync(
  "ffmpeg",
  ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", concatPath, "-c:a", "pcm_s16le", audioPath],
  {stdio: "inherit"},
);

const timings = [];
let cursorSeconds = 0;
for (const [index, scene] of scenes.entries()) {
  const durationSeconds = probeDuration(editedFiles[index]);
  const narrationDurationSeconds = narrationDurations[index];
  const startFrame = Math.round(cursorSeconds * fps);
  const durationFrames = Math.max(1, Math.round(durationSeconds * fps));
  timings.push({
    id: scene.id,
    startFrame,
    durationFrames,
    startSeconds: cursorSeconds,
    durationSeconds,
    narrationDurationSeconds,
    transitionPauseSeconds: durationSeconds - narrationDurationSeconds,
  });
  cursorSeconds += durationSeconds;
}

const formatTimestamp = (seconds) => {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};

const captions = [];
for (const [sceneIndex, scene] of scenes.entries()) {
  const timing = timings[sceneIndex];
  const sentences = scene.narration.split(/(?<=[.!?])\s+/).filter(Boolean);
  const weights = sentences.map((sentence) => Math.max(1, sentence.trim().split(/\s+/).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let sentenceCursor = timing.startSeconds;

  for (const [sentenceIndex, sentence] of sentences.entries()) {
    const isLast = sentenceIndex === sentences.length - 1;
    const duration = isLast
      ? timing.startSeconds + timing.narrationDurationSeconds - sentenceCursor
      : timing.narrationDurationSeconds * (weights[sentenceIndex] / totalWeight);
    captions.push({
      startSeconds: sentenceCursor,
      endSeconds: sentenceCursor + duration,
      text: sentence,
    });
    sentenceCursor += duration;
  }
}

await writeFile(
  captionPath,
  captions
    .map(
      (caption, index) =>
        `${index + 1}\n${formatTimestamp(caption.startSeconds)} --> ${formatTimestamp(caption.endSeconds)}\n${caption.text}\n`,
    )
    .join("\n"),
  "utf8",
);

await writeFile(
  timingPath,
  `${JSON.stringify(
    {
      fps,
      totalFrames: Math.ceil(probeDuration(audioPath) * fps),
      audioPath: "audio/sixty60-pilot.wav",
      captionPath: "captions/sixty60-pilot.srt",
      narration: {
        voice,
        speechSpeed,
        scenePauseSeconds,
        finalHoldSeconds,
      },
      scenes: timings,
      captions,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(`Saved pilot audio to ${audioPath}\n`);
process.stdout.write(`Saved timings to ${timingPath}\n`);
process.stdout.write(`Saved captions to ${captionPath}\n`);
