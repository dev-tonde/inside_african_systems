# Inside African Systems

Programmatic documentary starter for an independent, evidence-led YouTube channel about African companies, infrastructure, markets, and public systems.

## Start

Requirements: current Node.js LTS, npm, and FFmpeg.

```bash
npm install
npm run studio
```

Render the 30-second proof composition:

```bash
npm run render
```

Generate local narration:

```bash
npm run voice
```

The first Kokoro run downloads model files and therefore takes longer. Subsequent runs use the local cache.

## Episode 01 pilot

Generate the scene-timed narration, timings, and captions:

```bash
npm run pilot:voice
```

Inspect or render the pilot:

```bash
npm run pilot:studio
npm run pilot:frame
npm run pilot:thumbnail
npm run pilot:render
```

The pilot generator uses the approved scene script in
`content/episodes/sixty60/scenes.json`. It produces one narration segment per
scene, protects narration joins with short fades and chapter pauses, produces a
combined WAV file, exact Remotion timings, and an SRT caption track. FFmpeg is
required.

## What is implemented

- 1920×1080, 30 fps Remotion composition
- Five reusable documentary scene patterns
- Central brand tokens and safe margins
- Data-driven episode props
- Local Kokoro narration script
- Name research, topic slate, brand guide, and setup guidance

The demo copy is deliberately non-factual. Replace it only after the evidence workflow is complete.

## Documentation

- [Name and expansion decision](docs/01-name-and-expansion.md)
- [First 12 topics](docs/02-first-12-topics.md)
- [Channel brand guide](docs/03-channel-brand-guide.md)
- [Why a GitHub repository](docs/04-why-github.md)
- [Kokoro narration guide](docs/05-kokoro-guide.md)
- [Production workflow](docs/06-production-workflow.md)
- [Episode 01 evidence and production package](docs/episode-01-sixty60/)
- [Private YouTube upload setup](docs/07-youtube-private-upload-setup.md)
- [GitHub and YouTube upload handoff](docs/08-github-and-youtube-upload.md)
- [Episode length standard](docs/09-episode-length-standard.md)
