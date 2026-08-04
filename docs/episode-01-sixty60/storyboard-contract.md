# Storyboard contract

- `fps`: 30
- `width`: 1920
- `height`: 1080
- `total_frames`: 9,511
- `audio_plan`: One Kokoro narration segment per scene, concatenated into `public/audio/sixty60-pilot.wav`.
- `caption_plan`: Sixty-three sentence-level captions generated from the approved narration and exported to SRT.
- `assets`: Brand SVG mark, CSS/SVG diagrams, system fonts, Kokoro narration. No third-party footage, photographs, music, or sound effects.

| Scene | Start frame | Frames | Visual type | Source IDs | Mobile safe |
| --- | ---: | ---: | --- | --- | --- |
| hook | 0 | 723 | Five-link pipeline | C01, C03 | Yes |
| promise | 723 | 767 | Timeline/pipeline | C01, C02 | Yes |
| pipeline | 1,490 | 830 | Order pipeline | C03–C05 | Yes |
| network | 2,320 | 815 | Network diagram | C03, C06 | Yes |
| inventory | 3,135 | 802 | Inventory state cards | C05, C07 | Yes |
| software | 3,937 | 802 | Control-layer pipeline | C08 | Yes |
| pingo | 4,739 | 827 | Ownership network | C09 | Yes |
| scale | 5,566 | 748 | Metric panel | C10–C12 | Yes |
| performance | 6,314 | 788 | Metric panel | C13 | Yes |
| darkStores | 7,102 | 748 | Capacity panel | C14 | Yes |
| tradeoffs | 7,849 | 819 | Stakeholder panel | C15, C16 | Yes |
| close | 8,669 | 812 | System network | C03, C09, C17 | Yes |

Transitions are frame-based fades and staged reveals. Every scene carries its source line and claim IDs. The visuals describe mechanisms rather than simulating documentary footage.
