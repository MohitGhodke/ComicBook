# Comic Studio — working notes for Claude

## UI / design rules (do NOT violate)

This app has a **deliberately minimal, clean theme**. The user strongly dislikes
"AI-generated-looking" UI. When adding or changing any UI:

- **Minimal first.** Prefer whitespace and hairline dividers over boxes. Do NOT
  wrap things in cards/panels/bordered boxes by default. Avoid nested boxes.
- **No decorative borders or fills.** No heavy borders, no grey/coloured filler
  backgrounds. Backgrounds stay white or the established cool paper tokens.
- **Use the theme tokens only** (defined at the top of `src/styles.scss`):
  cool palette, `--accent` iris/indigo, fonts Space Grotesk (display) + Inter
  (body). **Never introduce warm/cream colours** (they read as "Anthropic") or
  new hardcoded hex colours — reference the CSS variables.
- The one place frames are intentional is the **rendered comic page** (panel
  frames). Keep those subtle/thin, not heavy black boxes.
- When in doubt, remove chrome rather than add it. Match the calm, editorial
  feel already in the shelf/creator, not a busy dashboard.

If a change would add visible borders, boxes, or background colours to the
editing UI, don't — find a lighter-weight layout instead.

## Architecture
See the persistent memory (`comicbook-studio-architecture`) for the full picture:
Angular app under `app/`, local-first IndexedDB (Azure Blob later), on-device AI
via a local OpenAI-compatible server, panel-based pages, page-at-a-time creator
with live preview.
