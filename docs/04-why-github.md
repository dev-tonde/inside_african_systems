# Why a YouTube channel needs a GitHub repository

A normal YouTube channel does not need GitHub. This channel does because its “studio” is software.

The repository stores:

- Remotion video templates
- AI workflow contracts
- Brand tokens
- Rendering scripts
- Caption and narration tooling
- YouTube upload code
- Cloud infrastructure
- Tests and quality gates
- Prompt and skill versions

## Practical reasons

### Reproducibility

When a good video is produced, Git records the exact template and rules used. If a later edit breaks captions or animation, the working version can be recovered.

### Review

AI-generated code and editorial-rule changes can be reviewed before they affect a published video.

### Automation

GitHub Actions can test the project, build the rendering container, and deploy a known commit to Azure.

### Auditability

Every production run can record a commit SHA. That ties a video to the exact code, visual system, and quality rules used.

### Separation

Source code belongs in Git. Large MP4 files, narration WAV files, downloaded assets, OAuth tokens, and secrets do not.

## What must not go into GitHub

- YouTube refresh tokens
- API keys
- Passwords
- Unlicensed media
- Large final renders
- Private legal documents
- Downloaded model caches

The repository should eventually be private. GitHub is not being used because this is a social-media project; it is being used because the production operation is a software system.
