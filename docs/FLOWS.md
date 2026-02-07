# JuiceIt Flow Diagrams

This document explains all the interactive flows in JuiceIt, including dry-run and interactive modes.

---

## Table of Contents

1. [Normal Mode Flow](#normal-mode-flow)
2. [Dry-Run Mode Flow](#dry-run-mode-flow)
3. [Interactive Mode Flow](#interactive-mode-flow)
4. [Confirmation Menu Options](#confirmation-menu-options)
5. [Interactive Review Menu Options](#interactive-review-menu-options)
6. [Re-Search Flow](#re-search-flow)
7. [Back Navigation](#back-navigation)

---

## Normal Mode Flow

Basic ripping without dry-run or interactive flags:

```
juice-it "Show Name"
    ↓
Scan DVD
    ↓
Lookup Metadata (TMDB)
    ↓
AI Map Tracks → Episodes
    ↓
AI Validate Mappings
    ↓
[Warnings?] → Show warnings menu (if any)
    ↓
Confirmation Menu: "Ready to Juice?"
    ├── 🍊 Juice it! → START RIPPING
    ├── ✏️ Edit mappings → Interactive Review
    ├── 🔍 Re-search → Metadata lookup again
    ├── 📋 Full interactive → Interactive Review
    └── ❌ Cancel → EXIT
    ↓
Rip all tracks with HandBrakeCLI
    ↓
Show completion summary
```

---

## Dry-Run Mode Flow

Testing mode that creates stub files OR switches to real encoding:

```
juice-it "Show Name" --dry-run
    ↓
Scan DVD
    ↓
Lookup Metadata (TMDB)
    ↓
AI Map Tracks → Episodes
    ↓
AI Validate Mappings
    ↓
[Warnings?] → Show warnings menu (if any)
    ↓
Confirmation Menu: "Ready to Juice? (DRY-RUN MODE)"
    │
    │   ℹ️ DRY-RUN MODE: No actual encoding will happen
    │      Small stub files will be created for reference
    │      Run without --dry-run to actually rip the tracks
    │
    ├── 🍊 Juice It! (rip tracks for real)
    │       ↓
    │   Switch to real encoding
    │   Update folder name (remove _DRYRUN suffix)
    │   Move log file to new folder
    │       ↓
    │   START REAL RIPPING
    │
    ├── 🧪 Continue with dry-run (stub files only)
    │       ↓
    │   CREATE STUB FILES (small text placeholders)
    │   Files go to: <name>_DRYRUN/
    │       ↓
    │   Show completion with command to run for real
    │
    ├── ✏️ Edit mappings → Interactive Review → (can go back)
    ├── 🔍 Re-search → Metadata lookup again
    ├── 📋 Full interactive → Interactive Review → (can go back)
    └── ❌ Cancel → EXIT (empty _DRYRUN folder)
```

**Key Behaviors:**
- Folder name includes `_DRYRUN` suffix
- If you select "rip for real": folder renamed, log moved, real encoding happens
- If you select "continue dry-run": stub files created in `_DRYRUN` folder
- Stub files contain metadata (track number, proposed filename)

---

## Interactive Mode Flow

Manual review and editing of all mappings:

```
juice-it "Show Name" --interactive
    ↓
Scan DVD
    ↓
Guided Metadata Selection (manual TMDB choice)
    ↓
AI Map Tracks → Episodes
    ↓
Interactive Review Menu (see below)
    ↓
Finalize mappings
    ↓
START RIPPING
```

---

## Confirmation Menu Options

The "Ready to Juice?" menu appears before ripping starts:

### Normal Mode:
```
🍊 Ready to Juice?

  📺 Show Name - Season 1
     Year: 2024

  Tracks to rip: 10

  Files to create:
    • Show Name (2024) - s01e01 - Episode Title.mp4
    • Show Name (2024) - s01e02 - Episode Title.mp4
    ...

? What would you like to do?
  > 🍊 Juice it!
    ✏️  Edit mappings
    🔍 Re-search with different query
    📋 Full interactive mode
    ❌ Cancel
```

### Dry-Run Mode:
```
🍊 Ready to Juice? (DRY-RUN MODE)

  📺 Show Name - Season 1
     Year: 2024

  Tracks to rip: 10

  Files to create:
    • Show Name (2024) - s01e01 - Episode Title.mp4
    • Show Name (2024) - s01e02 - Episode Title.mp4
    ...

  ℹ️  DRY-RUN MODE: No actual encoding will happen
     Small stub files will be created for reference
     Run without --dry-run to actually rip the tracks

? What would you like to do?
  > 🍊 Juice It! (rip tracks for real)
    🧪 Continue with dry-run (stub files only)
    ✏️  Edit mappings
    🔍 Re-search with different query
    📋 Full interactive mode
    ❌ Cancel
```

---

## Interactive Review Menu Options

When you enter interactive review (via "Edit mappings" or "Full interactive mode"):

```
📋 Review Track Mappings (Smart)

  Track  Duration  Status  Proposed Name
  -----  --------  ------  --------------------------------------
    1    23 min    ✓       Show Name (2024) - s01e01 - Title.mp4
    2    23 min    ✓       Show Name (2024) - s01e02 - Title.mp4
    3    0 min     ✓       (unrippable - 0 duration)
    4    23 min    ✓       Show Name (2024) - s01e03 - Title.mp4
    ...

  ✨ Tracks analyzed and mapped automatically
  💡 Use --verbose to see full reasoning for each track

? What would you like to do?
  > Edit Track Mapping
    Re-search TMDB and Re-auto-map
    Accept All and Start Ripping
    ← Back to confirmation menu
    Cancel
```

**Options explained:**

1. **Edit Track Mapping** - Change individual track assignments
   - Reassign to different episode
   - Edit filename
   - Toggle skip/include
   - Mark as unrippable

2. **Re-search TMDB and Re-auto-map** - Start over with new metadata
   - Guided TMDB selection
   - Re-calculates all proposed names

3. **Accept All and Start Ripping** - Finalize and begin encoding

4. **← Back to confirmation menu** - Return to previous menu
   - Preserves all edits
   - Lets you choose different action (e.g., "rip for real" in dry-run)

5. **Cancel** - Exit without ripping

---

## Re-Search Flow

When you select "Re-search with different query":

```
Current: Confirmation Menu
    ↓
Select: "🔍 Re-search with different query"
    ↓
Prompt: "Enter new search query:"
    [User types new query]
    ↓
Lookup Metadata with new query
    ↓
AI Map Tracks → Episodes (with new metadata)
    ↓
AI Validate Mappings
    ↓
Show NEW Confirmation Menu
    [With updated metadata and mappings]
    ↓
User can now:
    - Juice it!
    - Edit
    - Re-search again
    - Full interactive
    - Cancel
```

**Key Behaviors:**
- Updates `options.searchQuery` with new query
- Fetches fresh TMDB results
- Re-runs AI mapping with new metadata
- Re-validates mappings
- Shows confirmation menu again with new results
- Preserves dry-run mode if active

---

## Back Navigation

The back navigation feature allows moving backward through menus:

```
Confirmation Menu
    ↓
User selects: "📋 Full interactive mode"
    ↓
Interactive Review Menu
    ↓
User selects: "← Back to confirmation menu"
    ↓
[LOOP BACK]
    ↓
Confirmation Menu
    [Now user can choose different option]
```

**Technical Implementation:**
- `reviewAndMapEpisodesBeforeRip()` returns `{ _action: 'back' }`
- Calling code checks for this marker
- Loop continues, showing confirmation menu again
- All edits to mappings are preserved

**Available in:**
- Interactive Review → Back to Confirmation
- Edit Mappings (from confirmation) → Back to Confirmation
- Full Interactive Mode → Back to Confirmation

**Why this matters:**
- Prevents getting "trapped" in interactive mode
- Allows switching between "rip for real" and "continue dry-run"
- Lets you change your mind after reviewing mappings

---

## Examples

### Example 1: Quick Dry-Run Test

```bash
juice-it "Breaking Bad Season 1" --dry-run
```

Flow:
1. Scans disc
2. Looks up "Breaking Bad Season 1" on TMDB
3. AI maps 13 tracks → 13 episodes
4. Shows confirmation: "Ready to Juice? (DRY-RUN MODE)"
5. Select: "🧪 Continue with dry-run (stub files only)"
6. Creates stub files in `BREAKING_BAD_S01_2024-02-05_23-45-12_DRYRUN/`
7. Shows completion message with command to run for real

Result: Folder with small text files showing what would be created

---

### Example 2: Dry-Run Then Real Rip

```bash
juice-it "Breaking Bad Season 1" --dry-run
```

Flow:
1. Scans disc
2. Looks up "Breaking Bad Season 1" on TMDB
3. AI maps 13 tracks → 13 episodes
4. Shows confirmation: "Ready to Juice? (DRY-RUN MODE)"
5. Select: "🍊 Juice It! (rip tracks for real)"
6. Switches from dry-run to real encoding
7. Renames folder to `BREAKING_BAD_S01_2024-02-05_23-45-12/` (no _DRYRUN)
8. Moves log file to new folder
9. Starts real HandBrakeCLI encoding

Result: Real MP4 files in regular folder

---

### Example 3: Interactive Review with Back Navigation

```bash
juice-it "Breaking Bad Season 1" --dry-run
```

Flow:
1. Scans disc
2. Looks up "Breaking Bad Season 1" on TMDB
3. AI maps 13 tracks → 13 episodes
4. Shows confirmation: "Ready to Juice? (DRY-RUN MODE)"
5. Select: "📋 Full interactive mode"
6. Reviews track mappings table
7. Notices track 7 is mapped wrong
8. Select: "Edit Track Mapping" → Fix track 7
9. Select: "← Back to confirmation menu"
10. Back at confirmation menu, now select: "🍊 Juice It! (rip tracks for real)"
11. Switches to real encoding and starts ripping with corrected mappings

Result: Real MP4 files with manually corrected track 7

---

### Example 4: Re-Search After Bad Match

```bash
juice-it "Ed Edd n Eddy"
```

Flow:
1. Scans disc
2. Looks up "Ed Edd n Eddy" on TMDB
3. AI picks Season 1 (but disc is Season 5!)
4. Shows confirmation with Season 1 episodes
5. User realizes it's wrong
6. Select: "🔍 Re-search with different query"
7. Enter: "Ed Edd n Eddy Season 5"
8. New TMDB lookup finds Season 5
9. AI re-maps with Season 5 episodes
10. Shows NEW confirmation with correct episodes
11. Select: "🍊 Juice it!"
12. Starts ripping with correct metadata

Result: Files correctly named with Season 5 episodes

---

## State Diagram

```
┌─────────────────┐
│  START: Run     │
│   juice-it      │
└────────┬────────┘
         │
         v
┌─────────────────┐
│   Scan DVD      │
│  Get Metadata   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  AI Map Tracks  │
│   to Episodes   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  AI Validate    │ ──> [Warnings?] ──> Warnings Menu ──┐
│    Mappings     │                                      │
└────────┬────────┘                                      │
         │ <────────────────────────────────────────────┘
         v
┌─────────────────────────────────────────────────┐
│          Confirmation Menu Loop                 │
│  ┌─────────────────────────────────────────┐   │
│  │   "Ready to Juice?"                     │   │
│  │   [Normal or DRY-RUN MODE]              │   │
│  └──────────────┬──────────────────────────┘   │
│                 │                               │
│     ┌───────────┴────────────┐                 │
│     │                        │                 │
│     v                        v                 │
│  [Rip]                  [Edit/Interactive]    │
│     │                        │                 │
│     │                        v                 │
│     │            ┌──────────────────────┐     │
│     │            │ Interactive Review   │     │
│     │            │   - Edit tracks      │     │
│     │            │   - Re-search TMDB   │     │
│     │            │   - Accept           │     │
│     │            │   - Back ←────┐      │     │
│     │            └──────┬───────┘       │     │
│     │                   │               │     │
│     │                   └───────────────┘     │
│     │                [Loops back to menu]     │
└─────┼──────────────────────────────────────────┘
      │
      v
┌─────────────────┐
│  Start Ripping  │
│   (HandBrake)   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│   Completion    │
│    Summary      │
└─────────────────┘
```

---

## Tips for Developers

When modifying flows:

1. **Test all paths** - Each menu option should be tested
2. **Preserve state** - Mappings should persist through back navigation
3. **Clear messaging** - User should always know what mode they're in
4. **Idempotent operations** - Re-running same operation should be safe
5. **Exit paths** - Every menu needs a way to cancel/back out

When adding new menu options:

1. Update this FLOWS.md document
2. Add tests for the new flow
3. Update confirmation/interactive menu builders
4. Handle the new action in lib/rip.js
5. Update CLAUDE.md if it's a common task
