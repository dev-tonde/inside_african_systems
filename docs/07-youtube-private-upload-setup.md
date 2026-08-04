# Private YouTube upload setup

The automation must start with private uploads. Public scheduling should remain a separate, human-approved action until several pilot episodes have passed review.

## Required accounts and credentials

1. Create the YouTube channel and confirm its final name and handle.
2. Create a dedicated Google Cloud project.
3. Enable YouTube Data API v3.
4. Configure the OAuth consent screen.
5. Create a server-side or desktop OAuth client.
6. Authorise the minimum YouTube scopes needed for video, captions, and thumbnail management.
7. Request offline access and capture the refresh token.
8. Store client ID, client secret, and refresh token as encrypted repository or Azure secrets—never in Git.

YouTube account operations require OAuth user authorisation. A normal service account cannot act as a YouTube channel.

## Proposed secrets

```text
YOUTUBE_CLIENT_ID
YOUTUBE_CLIENT_SECRET
YOUTUBE_REFRESH_TOKEN
YOUTUBE_CHANNEL_ID
NOTIFICATION_WEBHOOK_URL
```

## Safe automation sequence

1. Research and generate the evidence ledger.
2. Require an approved script and storyboard.
3. Generate narration, captions, thumbnail, and MP4.
4. Run claim, rights, audio, frame, and metadata checks.
5. Calculate the final file and metadata hashes.
6. Check the publication ledger for an existing YouTube video ID.
7. Upload once with `privacyStatus: private`.
8. Upload the caption track and thumbnail.
9. Poll YouTube until processing succeeds.
10. Notify the owner with the private review URL.
11. Require explicit approval before setting a future `publishAt`.
12. Verify the scheduled state and send the final confirmation.

The publication ledger must be idempotent: a successful upload must never be retried as if it failed.

## Current YouTube API notes

As of July 2026, YouTube uses granular quota buckets for `videos.insert` and `search.list`. The exact quotas are visible in the Google Cloud Console and may change. Captions are uploaded separately. The API supports `status.containsSyntheticMedia`, which should be set conservatively for this channel’s AI-assisted production.

Official references:

- https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
- https://developers.google.com/youtube/v3/getting-started
- https://developers.google.com/youtube/v3/docs/videos
- https://developers.google.com/youtube/v3/docs/captions/insert
- https://support.google.com/youtube/answer/14328491
