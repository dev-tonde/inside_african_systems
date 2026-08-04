import {mkdir, readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {KokoroTTS} from "kokoro-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const inputPath = process.argv[2] ?? path.join(root, "content", "narration.txt");
const outputPath = process.argv[3] ?? path.join(root, "public", "audio", "narration.wav");
const voice = process.env.KOKORO_VOICE ?? "af_heart";
const text = (await readFile(inputPath, "utf8")).trim();

if (!text) {
  throw new Error(`Narration input is empty: ${inputPath}`);
}

await mkdir(path.dirname(outputPath), {recursive: true});

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
  dtype: "q8",
  device: "cpu",
});

const audio = await tts.generate(text, {voice, speed: 1});
await audio.save(outputPath);

process.stdout.write(`Saved narration to ${outputPath}\n`);
