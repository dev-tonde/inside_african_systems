# GitHub and YouTube upload handoff

GitHub stores the reproducible production system. YouTube receives the finished audience package. Do not put secrets, downloaded models, `node_modules`, working WAV files, or rendered MP4 files into normal Git history.

## What goes where

### GitHub repository

Commit these files:

- `content/` — approved narration and scene data
- `docs/` — research, rights, brand, QA, and operating guides
- `scripts/` — narration and render helpers
- `src/` — Remotion template and compositions
- `public/captions/` — timed SRT files
- `package.json`, `package-lock.json`, `tsconfig.json`, and `remotion.config.ts`
- `.gitignore` and `README.md`

Do not commit:

- `.env` files, OAuth tokens, API keys, or passwords
- `node_modules/`
- `public/audio/` generated WAV files
- `output/` renders and QA images
- Kokoro model caches

The final MP4 can be attached to a GitHub Release if a downloadable production master is needed, but YouTube or durable object storage should remain the canonical delivery location. GitHub warns above 50 MiB, blocks normal Git files above 100 MiB, and recommends Releases or Git LFS for large binaries.

## First GitHub push

Create an empty **private** repository named `inside-african-systems`. Do not add a README, licence, or `.gitignore` on GitHub because those already exist locally. Then run from the project folder:

```bash
git init -b main
git add .
git status
git commit -m "Initial Inside African Systems production system"
git remote add origin https://github.com/YOUR-USERNAME/inside-african-systems.git
git push -u origin main
```

Or, with the GitHub CLI already signed in:

```bash
git init -b main
git add .
git commit -m "Initial Inside African Systems production system"
gh repo create inside-african-systems --private --source=. --remote=origin --push
```

Before `git commit`, check `git status` and confirm that `.env`, `node_modules`, `output`, and generated audio are absent.

## YouTube private review upload

Upload this audience package:

1. `output/sixty60-pilot-final.mp4`
2. `output/sixty60-thumbnail.png`
3. `public/captions/sixty60-pilot.srt`
4. Title, description, chapters, and sources from `docs/episode-01-sixty60/youtube-metadata.md`

In YouTube Studio:

1. Select **Create → Upload videos** and choose the final MP4.
2. Add the approved title, description, source links, and chapters.
3. Upload the custom PNG thumbnail.
4. Set the audience accurately. This documentary is general-audience educational content, not content made specifically for children.
5. Under **Show more**, set language to English and category to Education.
6. Review the **Altered content** question. The current visuals are clearly stylised information graphics, while narration is synthetic. YouTube says production assistance such as scripts, captions, infographics, and audio repair does not by itself require disclosure; realistic or meaningfully synthetic material does. When in doubt, disclose—disclosure does not itself reduce monetisation eligibility.
7. Add captions during upload, or later through **Subtitles → Add language → Add → Upload file → With timing**.
8. Wait for HD processing and the copyright check.
9. Set visibility to **Private** for review. Do not schedule the public release yet.
10. Watch the private YouTube copy on a phone and desktop before approval. Platform encoding can reveal issues that are not present in the local file.

Official references:

- https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github
- https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
- https://support.google.com/youtube/answer/57407
- https://support.google.com/youtube/answer/2734796
- https://support.google.com/youtube/answer/72431
- https://support.google.com/youtube/answer/14328491
