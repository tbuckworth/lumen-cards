# Importing and studying decks

Open [Lumen](https://tbuckworth.github.io/lumen-cards/). If **Update now** appears, tap it. Check that Settings says **Lumen 1.3**. Keep your existing installation and browser data; updating preserves your cards.

## Importing

Use **Add → Import → Choose a deck file**. Lumen checks the whole file before saving cards and rolls back failed imports. If a text import reports a malformed or incomplete row, correct the file and import it again. Reported row numbers exclude comment and directive lines.

| Item | Rule |
| --- | --- |
| Deck files | Lumen JSON (`.lumen.json`), Claude's compact JSON, CSV, TSV, and Anki **Notes in Plain Text** exports. Export `.apkg` decks from Anki as **Notes in Plain Text** first. |
| Embedded images | PNG, JPEG or WebP encoded as `data:<MIME type>;base64,...` in `frontImage` or `backImage`. Each side needs text, an image, or both. |
| Unsupported media | SVG, GIF, HEIC, audio, remote image URLs and HTML media. Convert unsupported pictures before importing. |
| Import limits | Each image: 10 MiB and 40 million pixels. Each deck file: 100 MiB. Larger full backups can be restored through Settings, subject to device memory and storage. |
| Anki export | UTF-8 tab-separated text for text-only decks. Use Lumen JSON to share decks containing images. |

Tap an image to enlarge it; the enlarged view scrolls and supports browser pinch zoom. Answer images stay hidden until **Show answer**. Attach or replace images under **Add → One card**, or edit a card in Decks. Smaller images make imports and backups faster.

## Instructions to give Claude

> Make a Lumen deck with every original plate embedded in `frontImage` using the image format above. Give the deck a stable unique `id` and every card a distinct stable `id`. Keep those IDs when correcting a card. The front can say “Identify this plant” on every card, or be empty when an image is present. Put the species name on the back. Return a `.lumen.json` file.

Replace the example's ellipsis with the actual base64 image bytes:

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

## Studying

The daily allowance starts at 20 new cards per deck. Settings lets you change this allowance and the desired retention. A session shows new cards before reviews and shuffles each group. FSRS decides which reviews are due and when graded cards return.

Once nothing is due, **Study ahead** on Today or a deck lets you study remaining unseen cards. Those cards are graded and scheduled normally. Your daily allowance stays the same, and future reviews are not brought forward.

## Reimports and recovery

- With IDs, only the matching card in that deck is updated; its schedule and review history stay intact. Different IDs identify different cards, even with identical prompts and images. Never reuse a card ID across decks.
- Without IDs, Lumen matches normalized front text and the contents of both images. Repeated prompts with different images remain distinct. Changing an image without preserving the card ID creates a new card. Ambiguous matches and duplicate IDs produce errors.
- Before repairing an incomplete deck, save a full backup and regenerate the complete file from its original source. Keep the IDs to update existing cards. To retain a separate copy, give the replacement deck and its cards new IDs, then check the imported copy before deleting anything.

## Backups and privacy

**Export Lumen deck** includes images and IDs. **Settings → Save a full backup** also includes scheduling and review history. Restoring a backup replaces matching cards and their schedules; other cards remain.

Learning reports identify cards by ID and flag images. Share the deck alongside the report when Claude needs to see the plates.

Your images stay on the device. Use a normal browser tab or the installed app and keep full backups in Files/iCloud Drive. Private browsing discards data when its session ends.
