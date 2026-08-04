# Kokoro narration guide

## Honest verdict

Kokoro is not universally “better than every other voice tool.” ElevenLabs or a carefully directed human narrator may produce a better performance in some cases. Azure Speech may provide stronger enterprise controls and particular regional voices.

Kokoro is the best starting fit for this project because the current constraints are:

- No additional monthly fee
- Automatic generation
- Commercially usable open weights
- Local/offline inference after the model download
- No per-character bill
- No API key dependency
- Small enough to run on normal hardware
- Easy integration with the Node/Remotion project

The official model card describes Kokoro as an 82-million-parameter open-weight model, lists an Apache 2.0 licence, and provides 54 voices across eight languages in version 1.0. Review the model and voice licences again before commercial launch: [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M).

## Comparison

| Tool | Strongest advantage | Main problem for this project |
|---|---|---|
| Kokoro | Local, open-weight, lightweight, no usage bill | Pronunciation and performance still require direction |
| ElevenLabs | Highly expressive commercial voices | Recurring/usage cost and cloud dependency |
| Azure Speech | Enterprise platform, regional deployment, managed API | Consumption cost and less independence |
| Piper | Very lightweight and fully local | Generally less natural than stronger neural models |
| XTTS/voice cloning | Voice cloning and multilingual possibilities | Heavier runtime and greater consent/misuse risk |
| Human narrator | Best potential interpretation and authenticity | Not automatic and rarely free |

Do not use voice cloning for this channel. Select a built-in synthetic voice and disclose synthetic narration when platform rules require it.

## Option A — Included Node installation

Requirements:

- Current Node.js LTS
- npm
- FFmpeg
- Internet access for the first model download

From the project:

```bash
npm install
npm run voice
```

The script reads:

```text
content/narration.txt
```

and writes:

```text
public/audio/narration.wav
```

Choose another built-in voice:

```bash
KOKORO_VOICE=am_adam npm run voice
```

Test voices rather than choosing by name alone. The final selection must handle South African names, numbers and abbreviations consistently.

## Option B — Python reference implementation

For experimentation outside the Node project:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install "kokoro>=0.9.2" soundfile
```

Install `espeak-ng` through the operating system package manager. The exact command differs between macOS, Ubuntu and Windows.

The official model card provides the current `KPipeline` example. Prefer that source over third-party “Kokoro” websites.

## Production pronunciation workflow

1. Keep a pronunciation dictionary in version control.
2. Expand ambiguous abbreviations before synthesis.
3. Write currency and large numbers as they should be spoken.
4. Render one paragraph as a sample.
5. Correct names before rendering the full episode.
6. Normalize the final WAV with FFmpeg.
7. Listen to the complete narration during the pilot.

Example dictionary entries:

```json
{
  "Gauteng": "How-teng",
  "Mzansi": "Mm-zahn-see",
  "Sasol": "Sass-ol"
}
```

These are editorial hints, not universal phonetic truth. Validate local names with authoritative speakers.

## Where Kokoro is not enough

Move to another solution if:

- The selected voice repeatedly mishandles African names
- The narration lacks enough emotional control for long-form retention
- A required language has weak support
- Rendering speed is unacceptable on the chosen cloud CPU
- Audience feedback consistently rejects the voice

The sensible approach is a blind test: render the same 45-second passage with Kokoro, Azure Speech and one strong commercial alternative, then compare naturalness, pronunciation, consistency, rights, automation and cost.
