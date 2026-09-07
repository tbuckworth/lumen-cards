# Image decks in Lumen 1.1

Open [Lumen](https://tbuckworth.github.io/lumen-cards/), accept **Update now** if offered, and check that Settings says **Lumen 1.1**. Keep your existing installation and browser data. Updating does not reset your cards.

## For botanical identification

Use **Add → Import → Choose a deck file** to import the original 23-card deck again after its images have been embedded in the format below. Repeating “Identify this plant” is supported: different images remain different cards. The normal daily limit is 20 new cards, so a 23-card deck can correctly show only 20 due today; Settings lets you change that limit.

If an earlier import already collapsed the deck, Lumen cannot reconstruct the lost cards from that single saved card. Re-export from the original source, keeping all 23 images and distinct card IDs. Save a full backup first. Import the corrected file as a new deck (with a new deck ID and distinct card IDs) to keep the old attempt separate until you have checked the new deck.

Tap a card image to enlarge it. The enlarged view scrolls at the original resolution and supports the browser's pinch zoom. Answer images remain hidden until **Show answer**. You can also attach or replace images directly under **Add → One card**, or by editing a card in Decks.

## Instructions to give Claude

> Make a Lumen deck with all the original plate images embedded in `frontImage` as `data:image/png;base64,...`, `data:image/jpeg;base64,...`, or `data:image/webp;base64,...`. Do not put HTML image tags or remote URLs in the card text. Give the deck a stable unique `id` and every card a distinct stable `id`. Keep those IDs when correcting a card. The front can say “Identify this plant” on every card, or be empty when an image is present. Put the species name on the back, not in the front prompt or image itself. Return a `.lumen.json` file, not a pasted wall of base64.

Structure (the ellipsis below must be replaced by the actual base64 image bytes):

```json
{
  "format": "lumen-deck",
  "version": 1,
  "deck": {
    "id": "botanical-plates",
    "title": "Botanical plates",
    "cards": [
      {
        "id": "botanical-plates-001",
        "front": "Identify this plant",
        "frontImage": "data:image/jpeg;base64,...",
        "back": "Species name",
        "notes": "Features to look for",
        "source": "Book and plate number"
      }
    ]
  }
}
```

`backImage` uses the same format. Each side must have text, an image, or both. PNG, JPEG and WebP are supported; SVG, GIF, HEIC, audio, remote image URLs and HTML media are not. Convert unsupported pictures to PNG or JPEG before importing. Each image may be at most 10 MiB and 40 million pixels; deck imports may be at most 100 MiB. Larger full backups can be restored through Settings, subject to device memory and storage. Smaller images make imports and backups faster. Lumen validates the whole deck before writing and rolls back the import if any database write fails.

## Reimports and backups

- With IDs, only the matching ID in that deck is updated. Its schedule and review history remain intact. Different IDs are different cards even if they have identical prompts and images. IDs must not be reused across decks.
- Without IDs, Lumen matches normalized front text plus the contents of both images. Changing an image without preserving the card ID creates a new card. Ambiguous matches and duplicate IDs produce errors rather than choosing a card silently.
- **Export Lumen deck** includes images and IDs. **Settings → Save a full backup** includes images, scheduling and review history. Restore backups in Lumen 1.1 or later. Restoring replaces matching cards and their schedules; other cards remain.
- Anki text export is blocked for decks containing images because that format cannot carry Lumen's embedded media reliably. Use Lumen JSON for lossless sharing. Text files containing HTML media are rejected with an explanation.
- Learning reports identify cards by ID and flag images. Share the Lumen deck alongside the report when Claude needs to see the plates.

Your images stay in IndexedDB on the device. Lumen stores the binary bytes and MIME type, and creates temporary Blob URLs only for display. This avoids WebKit's Blob-write failures in ephemeral/private contexts without using external hosting. Private browsing still discards data when that browser session ends: use a normal Safari tab or the installed app and keep backups in Files/iCloud Drive.

## Verification

Regression tests import 23 generated test plates with identical prompts, reimport them, review and undo, export, restore a full backup, and verify decoded images after reload. They run in emulated iPhone WebKit, mobile Chromium, and desktop Chromium. Chromium additionally verifies offline service-worker reloads. Playwright WebKit cannot reliably emulate offline service-worker navigations; this is not a claim of physical-iPhone offline testing.

Implementation references: [Blob URL lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static), [Dexie transactions](https://dexie.org/docs/Dexie/Dexie.transaction()), and [WebKit Blob storage issue](https://bugs.webkit.org/show_bug.cgi?id=188438).
