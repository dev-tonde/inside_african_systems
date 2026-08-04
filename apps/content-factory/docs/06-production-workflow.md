# Production workflow

## Skills

1. `$channel-director` defines fit and scope.
2. `$topic-scout` ranks demand and selects an episode.
3. `$evidence-researcher` builds the claim ledger.
4. `$documentary-scriptwriter` writes sourced narration.
5. `$storyboard-director` creates timed scenes.
6. `$motion-renderer` builds and renders the composition.
7. `$rights-policy-auditor` performs the blocking editorial audit.
8. `$qa-publisher` verifies files and controls private upload.

## Pilot gates

- Videos 1–5: human approval at research, script, render, and publish.
- Videos 6–12: automatic private upload; human public-publish approval.
- Videos 13–20: low-risk scheduling may be automated after the YouTube API compliance audit and a clean quality record.

## Next implementation work

- Replace demo data with a complete episode JSON schema.
- Add narration duration measurement and composition metadata calculation.
- Integrate captions and word-level timings.
- Add chart, map, timeline, quote and source-card components.
- Add a 9:16 Shorts composition.
- Add render-report generation.
- Add `ffprobe` QA.
- Add asset-rights manifest validation.
- Add YouTube private-upload integration.
- Add Azure Container Apps packaging only after the local pilot succeeds.
