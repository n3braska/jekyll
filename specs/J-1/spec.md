# J-1 · Word timetable import into the admin panel

| | |
|---|---|
| Status | Implemented, not yet deployed (2026-10-12, see §10) |
| Created | 2026-10-12 |
| Sample inputs | `temp/*.docx` (9 files, Dec 2025 – Oct 2026) |
| Affected data | new `_data/timetable/YYYY-MM.yml`; replaces `_data/{ua,de}/calendar_josaphatskapelle.yml`, `_data/{ua,de}/calendar_jesuitenkirche.yml`, `_data/publishedMonths.yml` |
| Affected UI | `admin/` (Netlify CMS), `_includes/indextimetable_*.html` |

## 1. Goal

Each month the parish sends the service timetable as a Word file. Today it is converted to YAML by hand: four files, two languages, two churches. That takes time and invites mistakes.

**Target workflow:** in the admin panel, upload the `.docx`. You get a **prefilled, editable month** (UA + DE, St. Barbara + Jesuitenkirche). You review it, fix what the converter got wrong, and publish. Nothing goes live until you publish.

## 2. Current state (as-is)

### 2.1 Data files

Four calendar files with the same shape:

```yaml
month:                      # always exactly 12 entries, index 0 = January … 11 = December
  - announcement: "У церкві св. Варвари: Postgasse 8A. Сповідь …"
    day:
      - d: 1
        event:
          - time: " 18:00"            # leading space appears in most entries
            title: Служба Божа
            occasion: Поминання померлих   # optional, per event (see 2.4)
          - time: " 19:00"
            title: Молебень
        occasion: null              # per day
    month_date: 06-2023            # informational only, often stale
```

| File | Content |
|---|---|
| `calendar_josaphatskapelle.yml` | St. Barbara, Postgasse 8A: every service **except** the Sunday 12:30 one |
| `calendar_jesuitenkirche.yml` | Only the Sunday/feast **12:30** Ukrainian liturgy in the Jesuitenkirche |

The month slots are **reused every year**: a new month overwrites slot `month - 1`. There is no history beyond git.

`_data/publishedMonths.yml` controls visibility for both languages. It has 12 entries `{number: 0..11, isPublished: bool}`, and the templates show every published slot in list order.

### 2.2 Rendering

`_includes/indextimetable_josaphatskapelle.html` and `_includes/indextimetable_jesuitenkirche.html`:

- show `announcement` of the **current** month slot;
- for each published month, render each day with `d` + month genitive (from `months.yml`), then `event.time` + `event.title`, then the day-level `occasion`.

### 2.3 Admin panel today

- `admin/index.html` loads `netlify-cms@^2.0.0` (unmaintained; its successor is **Decap CMS 3.x**) with Netlify Identity + `git-gateway` on `master`.
- `admin/config.yml` exposes **only the two Jesuitenkirche calendars**. The St. Barbara calendars, the larger ones, are not editable in the CMS. Neither is `publishedMonths.yml`.
- The CMS schema has an `is_published` field per month that the templates **don't use**. They use `publishedMonths.yml`.

### 2.4 Observed issues in the existing data (to fix or keep in mind)

1. **Notes of individual services are stored in two awkward ways.** Mostly they are put into the title in brackets (e.g. 1 June 2026: `Служба Божа (Поминання померлих)`, `Молебень (Зустріч «Матері в молитві»)`). In older months they sit in a per-event `occasion` field (98 times), which the template never renders. → Resolved by giving every service its own notes list (§4.4, decisions 2 and 10); the migration moves both forms into it (§5.6).
2. `_data/ua/calendar_josaphatskapelle.yml`, last line: `month_date: 12-2023` is not indented. It becomes a top-level key, so the December slot has no `month_date`. This is harmless today but would break a strict parser.
3. `month_date` is stale in most slots (`01-2023`, `08-2024`, …), so it can't be used to work out which year a slot holds.
4. The client-side script in `_layouts/indexlayout.html` compares months without a year, so the December → January change doesn't work (see §5.7).
5. **Month data in the wrong slot.** The July 2026 timetable was written into the August slot (index 7) and August 2026 into the September slot, which the September update then overwrote. In August the site therefore showed July's services under "серпня". The migration detects this (§5.6).
6. **Unquoted times break.** Jekyll reads YAML 1.1, where `time: 18:00` is the number 64800 (base 60). The leading space in `" 18:00"` happened to avoid that. Decap saves times unquoted, so the template converts such numbers back (§5.5).
7. **Invalid CMS entry.** The "Blog Posts" item in `admin/config.yml` used `folder` inside a files collection, pointing to a non-existent `content/posts`. Decap 3 refuses to start with it, so it was removed.
8. Quoting and the leading space in `time` are inconsistent (`" 18:00"` vs `"18:00"`, quoted vs unquoted titles). The leading space is not intended → cleaned up during migration and never produced by the import (decision 4).

## 3. Source format: the Word file

Based on the 9 samples in `temp/`.

### 3.1 Document layout

```
[optional] Parish header lines (name, priests, phone numbers)
[optional] Month heading          e.g. "СЕРПЕНЬ"
[optional] Note line              e.g. "Сповідь до або після богослужінь …"
TABLE 1   → Ukrainian timetable
[optional] Parish header (DE)
[optional] Month heading (DE)     e.g. "AUGUST"
[optional] Note line (DE)
TABLE 2   → German timetable
```

Every sample has **exactly two tables**: UA first, DE second. `12.docx` has **no headings at all**, so the month can't always be read from the text.

### 3.2 Table rows

Typical row, with 5 cells and the lines inside a cell separated by `|`:

| Day | Weekday [+ feast/Sunday name] | Times | Titles | Notes |
|---|---|---|---|---|
| `07` | `Неділя. Всіх святих українського народу` | `09:30 \| 12:30 \| 15:00 \| 18:00` | `Служба Божа ×4` | ` \| українською в церкві о. Єзуїтів \| угорською \| німецькою` |
| `01` | `Понеділок` | `18:00 \| 19:00` | `Служба Божа \| Молебень` | `Поминання померлих. \| Зустріч «Матері в молитві»` |
| `04` | `Четвер` | `09:30` | `Служба Божа` | `Торжественне поклоніння …` |

Lines in the times, titles and notes cells **line up by position**: line *i* of each cell describes service *i*.

### 3.3 Variations and quirks the parser must handle

| # | Case | Example |
|---|---|---|
| Q1 | **Merged cells**: a day spans two rows (`vMerge`); the first row has one wide cell (`gridSpan=3`) holding a day-level note | `02.docx` Feb 1 and Feb 2: "Передсвяття Стрітення, після закінчення літургій …" |
| Q2 | Weekday cell holds a second line with the feast or Sunday name | `Понеділок \| Стрітення Господнє`, `Sonntag des verlorenen Sohnes` |
| Q3 | Weekday and feast name in one line, split by `.` | `Неділя. Всіх святих українського народу` |
| Q4 | Line counts don't match (lines merged or missing in one cell) | DE Aug 2: 4 times but 3 title lines (`Hl. Liturgie (Ungarisch) Hl. Liturgie (Deutsch)` in one paragraph); DE Oct 1: 2 times, 1 title |
| Q5 | Several times in one paragraph | DE Dec 1: `18:00 19:00` |
| Q6 | Empty filler lines in the times or titles cells | DE Feb 2: `09:30 \|  \| 18:00 \|  ` |
| Q7 | Trailing spaces and trailing dots | `Поминання померлих.  `, `Gedächtnis der Verstorbenen     ` |
| Q8 | Typos in the source | `угорськоью`, `словацькоью` |
| Q9 | **UA and DE tables disagree** | June 4: UA 09:30, DE 18:00 (the published YAML used 09:30 for both; from now on each table keeps its own value and a warning is logged). Feb: UA has *Поминання* on Mon 2, DE on Tue 3 |
| Q10 | Rows with a single cell (separator or comment) | `12.docx`, `Розклад на березень 2026 1.docx` |
| Q11 | Inconsistent filenames | `08.docx` vs `Розклад на січень 2026.docx` |

### 3.4 Sample corpus

The year is inferred from the weekday of day 1 or the first listed day.

| File | Month | Year |
|---|---|---|
| `12.docx` | December | 2025 |
| `Розклад на січень 2026.docx` | January | 2026 |
| `02.docx` | February | 2026 |
| `Розклад на березень 2026 1.docx` | March | 2026 |
| `05.docx` | May | 2026 |
| `06.docx` | June | 2026 (matches the published slot 5; reference month) |
| `07.docx` | July | 2026 |
| `08.docx` | August | 2026 |
| `10.docx` | October | 2026 |

## 4. Conversion rules (Word → YAML)

These rules were reverse-engineered from the published data (June 2026 is the reference month) and updated with the decisions in §7.

**Core principle (decision 3):** the UA table and the DE table are **parsed independently**. Each one produces its own language block. Nothing is copied, merged or "corrected" from one language into the other. Differences between them only produce warnings (§4.7).

### 4.1 Month and year detection

1. Month: from the heading (`СЕРПЕНЬ`, `AUGUST`, …), else from the filename (`08.docx`, `…на січень 2026…`), else the user picks it.
2. Year: the closest year (current, then next, then previous) where every row's weekday matches the date. If none matches, warn and ask.
3. If the UA and DE headings point to different months, warn and use the UA one.
4. The user can always override both month and year in the admin UI.

### 4.2 Row to day (per table)

- `d` = integer of the day cell (`07` → `7`).
- Rows linked by `vMerge` are folded into one day (Q1).
- The weekday is dropped. Text after the weekday (second line, or after `.`) becomes the **feast name** (Q2, Q3).
- Lines in the times, titles and notes cells are paired by index after cleanup (§4.5). If the counts still differ, keep what can be paired and **log a warning** for that day (Q4). Unpaired lines are kept, never silently dropped: an unpaired title becomes an event with an empty time, and an unpaired note goes to the first St. Barbara service of the day.

### 4.3 Assigning services to the two churches

**Decision 9:** both churches share **one day list per language**. Each service has a flag `isJesuitenKirche`; `true` puts it into the Jesuitenkirche timetable, otherwise it is in the St. Barbara timetable.

| Service | `isJesuitenKirche` |
|---|---|
| Its note line contains `Єзуїт` / `Jesuitenkirche` (normally the Sunday 12:30) | `true` |
| everything else | `false` |

Reference: June 7, 2026 (UA): 09:30, 15:00 and 18:00 with `false`, 12:30 with `true` and the note *Всіх святих українського народу*.

### 4.4 Title, notes and language suffix

**Decisions 2 and 10:** notes belong to a **service**. Each service has its own `occasion` list, and the flag covers both the service and its notes. There is no day-level note any more.

| Situation | Output |
|---|---|
| Note line is a **language** (`угорською`, `німецькою`, `словацькою`, …) | Appended to the title: `Служба Божа угорською`. DE titles usually carry it already, e.g. `Hl. Liturgie (Ungarisch)`. For a plain DE title, map `Ungarisch/Deutsch/Slowakisch` → `(…)` |
| Note line is the Jesuitenkirche marker | Sets the flag (§4.3); any extra text becomes a note of that service |
| Note line next to a service | `occasion` of that service |
| Feast name from the weekday cell | First note of the Jesuitenkirche service of that day, otherwise of the first service |
| Note for the whole day (merged wide cell Q1, heading line, note that doesn't line up) | First notes of the first St. Barbara service |
| Day with notes but no service | An entry without time and title holding the notes (warning) |
| No notes | `occasion: []` |

Example, 1 June 2026 (UA):

```yaml
- d: 1
  event:
    - time: "18:00"
      title: "Служба Божа"
      occasion: ["Поминання померлих"]
      isJesuitenKirche: false
    - time: "19:00"
      title: "Молебень"
      occasion: ["Зустріч «Матері в молитві»"]
      isJesuitenKirche: false
```

The template prints each service as a row: time, title, notes (one per line).

### 4.5 Text cleanup

- Trim whitespace, collapse double spaces, strip one trailing `.` from notes.
- Fix known typos with a small dictionary (`угорськоью` → `угорською`, `словацькоью` → `словацькою`). The dictionary is editable. Every applied fix is logged as an info message.
- Times: normalise to `HH:MM`. Split `18:00 19:00` (Q5). Drop empty lines (Q6).
- **No leading spaces (decision 4):** times are written as `time: "18:00"`. The `" 18:00"` form in the existing data is a mistake and is cleaned up during migration (§5.6).
- Quote all strings in the output.

### 4.6 Announcement

The Word file does not contain the full announcement. The import builds it from a fixed prefix per church and language, plus the note lines under the month heading (e.g. "Сповідь до або після богослужінь …") and any full-width table rows (Q10, e.g. "14-18 грудня Різдвяні реколекції …"):

| | UA | DE |
|---|---|---|
| St. Barbara | `У церкві св. Варвари: Postgasse 8A.` + notes from the UA part | `In der Kirche St. Barbara: Postgasse 8A.` + notes from the DE part |
| Jesuitenkirche | `У церкві отців Єзуїтів - Jesuitenkirche: Doktor-Ignaz-Seipel-Platz 1` | `In Jesuitenkirche: Doktor-Ignaz-Seipel-Platz 1` |

When re-importing into an entry, a hand-written announcement is kept if the Word file has no notes for it. One-off texts (e.g. "priests are away 3–6 June") are added by hand in the review step.

### 4.7 Warnings log

Warnings never block the import. Each one names the language, church and day, so the user can jump to it. The log is shown in the admin panel and returned by the parser for tests and the CLI.

**Within one table:**
- A day's weekday doesn't match the detected year.
- Different line counts in a row (Q4); says which lines were left unpaired.
- Empty title, unparsable time, or unknown language word.
- A row that could not be interpreted at all (Q10), with its raw text.
- Duplicate day numbers, or days out of order.

**Between the UA and DE tables (decision 3):**
- A day exists in one language only (e.g. Feb 2026: *Поминання* on Mon 2 in UA, Tue 3 in DE).
- Same day, different number of services.
- Same day and service position, different time (e.g. June 4: UA 09:30, DE 18:00).
- Jesuitenkirche service present in one language only.

**On save:**
- A file for this month already exists and would be overwritten.

### 4.8 Additional rules found while testing the samples

| Case | Rule | Example |
|---|---|---|
| Title wraps onto a line without a time | Joined with the previous title if that ends with `та/і/й/und/and/,` | Jan 5: `Служба Божа та` + `Велике Водосвяття` |
| First title line has no time while counts differ | Treated as a note for the day | May 29: `Довга ніч церков` |
| One time, several titles | All titles get that time (info) | Mar 7: four catechesis groups at 15:00 |
| One title, several times | All times get that title (info) | Dec 5: show at 16:00 and 18:00 |
| Notes start a line too high | Shifted so that the Jesuitenkirche marker lines up with the 12:30 service (info) | Oct 4, Dec 25 (UA) |
| Marker with more text | The marker phrase is removed, the rest becomes a note of the Jesuitenkirche day | Jun 21: `ПЕРШЕ ПРИЧАСТЯ в церкві о. Єзуїтів` |
| Jesuitenkirche service at another time | Kept at its time | Aug 30: 12:15; Dec 12: concert at 18:00 |
| `(Ukrainisch)` in DE titles | Removed, Ukrainian is the default (like UA titles) | `Hl. Liturgie (Ukrainisch)` → `Hl. Liturgie` |
| No Jesuitenkirche marker on a 12:30 service | Stays at St. Barbara (12:30 at St. Barbara exists, e.g. Sep 2026); the UA/DE comparison warns | Jan 4 (UA), Jun 21 (DE) |

## 5. Solution

### 5.1 Parser (shared core)

A single dependency-light **JavaScript** module, `admin/timetable/parse-docx.js`. It runs in the browser for the admin panel and in Node for tests and an optional CLI.

- Unzip with JSZip (CDN, pinned version), read `word/document.xml` with `DOMParser`.
- Walk `w:tbl` / `w:tr` / `w:tc` / `w:p`, respecting `w:gridSpan` and `w:vMerge`.
- Table 1 → `ua`, table 2 → `de`. Each table goes through the same row parser on its own. The UA/DE comparison runs afterwards on the finished results.
- Output: the month file structure (§5.4) plus `warnings: [{level, lang, church, d, message}]`.
- Tests: fixtures from `temp/*.docx`. The expected June 2026 output is derived from the published data plus the decided changes.

### 5.2 Admin integration: one file per month (decision 1)

| | |
|---|---|
| Storage | `_data/timetable/YYYY-MM.yml`, holding both languages and both churches plus `published: true/false` |
| CMS | Decap **folder collection** (`create: true`): one entry = one month, file name from `month_date`. A custom **"Import from Word"** widget fills the entry; all normal fields stay editable |
| Review | Decap **editorial workflow**: Draft → In review → Ready → Publish (§5.3) |
| Publish | Publishing the entry merges it to `master`; the `published` flag then controls visibility |
| Templates | `_includes/indextimetable_*.html` render the latest published months from `site.data.timetable`. The browser script picks the current and next month, **max 2** (§5.7) |
| Source file | The uploaded `.docx` is kept as `assets/timetables/YYYY-MM.docx` and linked from the entry (`source_docx`) |
| History | Every month is kept; nothing is overwritten |
| Retired | `_data/{ua,de}/calendar_*.yml`, `_data/publishedMonths.yml`, and the two calendar entries in `admin/config.yml` |

Rejected alternatives: keeping the four files with a GitHub Action merging a draft into them (two writers, failures invisible in the CMS), and a CLI only (doesn't meet the goal). The CLI still comes for free from the shared parser, as a fallback.

### 5.3 User flow

1. Admin → **Розклад / Gottesdienstordnung** → **New Місяць / Monat**.
2. In the field **Word-файл / Word-Datei**, upload the `.docx` through the media library. It is stored in `assets/timetables/` under its upload name.
3. Click **Заповнити з Word-файлу / Aus Word-Datei ausfüllen** at the top of the month. The widget parses the file in the browser and fills:
   - `month_date` (e.g. `2026-11`)
   - UA St. Barbara / UA Jesuitenkirche / DE St. Barbara / DE Jesuitenkirche: announcement, days, services, notes
   - `published` stays as set (default **on**; visibility is gated by the review workflow, see step 6)

   Alternative: "або вибрати файл з комп’ютера" parses a local file without storing it.
4. The warnings log (§4.7) shows in a box above the fields (⚠ = check, ℹ = automatic fix).
5. The user edits anything in the normal CMS fields and saves. With the editorial workflow the entry is saved as **Draft** on its own `cms/…` branch with a pull request. The file name is the month (`_data/timetable/2026-11.yml`). Nothing reaches `master` or the live site.
6. Review: move the entry to **In review** / **Ready**. The pull request triggers the existing Azure Static Web Apps workflow, which builds a **preview environment** for checking the timetable.
7. **Publish** in the Decap workflow board merges the pull request into `master` and the month goes live, within the 2-month window (§5.7).
8. To prepare a month without showing it after merging, untick `published`. To take a live month offline, untick `published` and publish again.
9. Filling an entry that already has days asks before overwriting them.

### 5.4 New data file

The month data sits under one key `month`, because the import widget is a wrapper around Decap's object editor and can only fill its own field. `published` stays outside so it is not overwritten by an import.

```yaml
# _data/timetable/2026-06.yml
published: true
month:
  month_date: "2026-06"
  source_docx: "/assets/timetables/2026-06.docx"
  ua:
    announcement: "У церкві св. Варвари: Postgasse 8A. …"
    announcement_jesuit: "У церкві отців Єзуїтів - Jesuitenkirche: Doktor-Ignaz-Seipel-Platz 1"
    day:
      - d: 7
        event:
          - time: "09:30"
            title: "Служба Божа"
            occasion: []
            isJesuitenKirche: false
          - time: "12:30"
            title: "Служба Божа"
            occasion:
              - "Всіх святих українського народу"
            isJesuitenKirche: true
          - time: "15:00"
            title: "Служба Божа угорською"
            occasion: []
            isJesuitenKirche: false
  de:
    announcement: "In der Kirche St. Barbara: Postgasse 8A. …"
    announcement_jesuit: "In Jesuitenkirche: Doktor-Ignaz-Seipel-Platz 1"
    day: [ … ]
```

CMS: folder collection `timetable` with `identifier_field: month.month_date`, so the file name is the month. Fields: `published` (boolean); `month` (custom widget `timetable`) → `month_date` (string, `YYYY-MM`), `source_docx` (file, `assets/timetables/`), `ua`/`de` → `announcement` (text, St. Barbara), `announcement_jesuit` (text), `day` (list) → `d` (number), `event` (list) → `time` (string `HH:MM`), `title` (string), `isJesuitenKirche` (boolean, default off), `occasion` (list of strings).

### 5.5 Platform notes

- Upgrade `admin/index.html` from `netlify-cms@^2` to a pinned **Decap CMS 3.x**. Netlify Identity + `git-gateway` keep working.
- The site is deployed by GitHub Actions to Azure Static Web Apps. Pushes to `master` deploy production, and pull requests get a preview environment. With the editorial workflow, drafts live on `cms/…` branches with PRs, so only **Publish** deploys to production.
- Parsing happens entirely in the browser.
- Decap writes times unquoted (`time: 18:00`), which Jekyll reads as seconds (§2.4.6). `_includes/timetable_church.html` converts such numbers back to `HH:MM`, so it works with both quoted and unquoted times.
- `admin/config.yml` gets `publish_mode: editorial_workflow`. Decap supports this with `git-gateway` on GitHub. It applies to **all** collections, so news and pages also go through Draft → Ready → Publish (agreed).
- Decap only shows a "View preview" link when the deploy reports a commit status. Azure SWA posts the preview URL as a PR comment, so the link may need to be opened from the PR. This needs checking during implementation.
- Source files: the import widget saves the uploaded `.docx` through Decap's media API into `assets/timetables/` (per-field `media_folder`), so it is committed together with the entry. Fallback if the widget API doesn't allow that: a separate `source_docx` file field where the user attaches the same file.

### 5.6 Migration of existing data

A one-time script converts the 12 slots of the four current files into `_data/timetable/YYYY-MM.yml`:

- Year per slot: `month_date` is unreliable (§2.4.3), so it is inferred from weekdays the same way as §4.1 (e.g. slot 5 → `2026-06`). Slots that can't be dated with confidence are **dropped** (decision 8); the script prints which ones.
- Merge each slot's UA/DE × Barbara/Jesuit data into one file.
- Strip the leading spaces from `time` and normalise quoting.
- The St. Barbara and Jesuitenkirche days of a slot are merged into one day list; their services get `isJesuitenKirche: false/true` and are sorted by time.
- Notes: brackets in titles and per-event `occasion` stay with their service; the old day `occasion` goes to the first service of that church on that day.
- The old files are read from git (commit `c126b87`), as they are no longer in the working tree.
- `published` comes from the current `publishedMonths.yml`.
- All sample Word files are archived as `assets/timetables/YYYY-MM.docx`; migrated months whose file exists link to it in `source_docx`.

Result of `ruby _scripts/migrate_timetable.rb --write` (run against the files as of commit `c126b87`):

| Slot | Result |
|---|---|
| 0 Jan | 2026-01 |
| 1 Feb | 2025-02 → dropped (before 2026) |
| 2 Mar | 2026-03 |
| 3 Apr | 2026-04 (2/3 Sundays match: Easter week) |
| 4 May | 2026-05 |
| 5 Jun | 2026-06 |
| 6 Jul | 2025-07 → dropped |
| 7 Aug | **2026-07** (July data in the August slot, §2.4.5), published |
| 8 Sep | 2026-09, published |
| 9 Oct | 2025-10 → dropped |
| 10 Nov | 2025-11 → dropped |
| 11 Dec | could not be dated → dropped |

August 2026 is lost in the old data (overwritten), and October 2026 was never added. Its Word file (`assets/timetables/2026-10.docx`) can be imported through the admin panel.
- Check: the rendered timetable for currently published months looks the same before and after, apart from per-event notes now becoming visible.

### 5.7 Visible months in the timetable components

Replaces `publishedMonths.yml`.

**Constraint:** the site is rebuilt **only when new content is committed**. There is no scheduled rebuild. So the build can't know which month is "current", and the choice has to be made in the **browser**, as it partly is already.

**Today:** the script in `_layouts/indexlayout.html` (around line 88) reads `data-month` (0–11) and `data-day` from each `.list-group-item`. It shows the days from today up to today + 7 and fills the rest of the 7-day window from the next month. Two problems:
- The month has no year, so December → January breaks: `0 > 11` is false, and the January days are never shown.
- The announcement is chosen at build time using `'now'`, so it goes stale between builds.

**New behaviour:**

1. **Build (Liquid):** both `indextimetable_*.html` includes render every `published: true` month in `site.data.timetable`, sorted by `month_date`, limited to the **latest 3** to keep the page small. Each day item gets `data-month="YYYY-MM"` and `data-day="D"`. Each month's announcement is rendered too, as a hidden element with `data-month="YYYY-MM"`.
2. **Browser (JS):** take the current `YYYY-MM` and the next one from the visitor's clock.
   - Only items of those **2 months at most** can be shown.
   - Keep the existing 7-day window logic, but compare `YYYY-MM` strings so the year change works.
   - Show the announcement of the current month, or of the next month if the current one is missing.
3. If the current and next months are both missing, nothing is shown, with no error. This happens when a timetable wasn't published in time.

As a result, a month published in advance appears automatically when the date arrives, and the old month disappears without a rebuild.

## 6. Out of scope

- Translating UA ↔ DE automatically or filling one language from the other.
- Parsing other layouts (PDF, images, free text).
- Changing the visual design of the timetable, beyond rendering the `occasion` list.

## 7. Decisions and open questions

### Decided (2026-10-12)

1. **Storage:** one file per month (`_data/timetable/YYYY-MM.yml`). The four `calendar_*.yml` files and `publishedMonths.yml` are retired.
2. **Day notes:** notes become a list, like `event` is a list of times. (Refined by decision 10: the list sits on each service.)
3. **UA vs DE:** each table is treated individually. Conflicts and missing items are logged as warnings; nothing is reconciled automatically.
4. **Leading spaces in `time`:** not intended. They are removed in migration and never produced by the import.

5. **Source files:** the uploaded `.docx` is preserved as `assets/timetables/YYYY-MM.docx`.
6. **Visible months:** at most **2** months are shown in the timetable components. The site is rebuilt only on new commits, so the browser selects the months by date (§5.7).
7. **Review:** Decap editorial workflow, Draft → Ready → Publish, for **all** collections (news and pages too).
8. **Undatable old slots:** dropped during migration.
9. **One day list for both churches** (2026-10-12): each service has `isJesuitenKirche`; `true` → Jesuitenkirche timetable, otherwise St. Barbara (§4.3).
10. **Notes per service** (2026-10-12): notes are a list on each service and share its flag; this replaces the day-level list of decision 2 (§4.4). Both announcements per language stay (`announcement`, `announcement_jesuit`).

### Still open

None. (To check after deployment: the preview link in Decap, §5.5.)

## 8. Acceptance criteria

- [ ] Uploading each file in `temp/` gives a prefilled month with the correct month and year (the user picks the month for `12.docx` if it isn't detected).
- [ ] UA and DE are parsed independently. For `06.docx`, June 4 is 09:30 in UA and 18:00 in DE, and a cross-language warning is logged.
- [ ] For `02.docx`, the different *Поминання* days (UA Mon 2, DE Tue 3) are logged as warnings, and each language keeps its own data.
- [ ] Days with several notes produce an `occasion` list (e.g. 1 June: two items), and the site shows every item.
- [ ] No generated or migrated `time` value has leading or trailing spaces.
- [ ] Services marked as Jesuitenkirche in the Word file get `isJesuitenKirche: true`, all others `false`; each timetable shows only its services.
- [ ] Notes are stored on the service they belong to and shown next to it.
- [ ] Every quirk Q1–Q10 is handled or produces a warning. No silent data loss.
- [ ] Nothing appears on the public site until the entry is published through the Draft → Ready → Publish workflow, and drafts get an Azure preview environment.
- [ ] The timetable components show at most 2 months (current + next, by the visitor's date) without needing a rebuild, including across the December → January change.
- [ ] Every imported month has its `.docx` stored in `assets/timetables/` and linked in `source_docx`.
- [ ] Both languages and both churches can be edited in the admin panel.
- [ ] The parser has automated tests running on the sample corpus.

## 9. Next steps

1. Review and commit the change (see §10). Deploy, then log in to `/admin/` and check the editorial workflow and the preview link with a real draft.
2. Pilot: import the November 2026 Word file (or October from `assets/timetables/2026-10.docx`).

## 10. Implementation

| File | Purpose |
|---|---|
| `admin/timetable/parser.js` | Word → month data, warnings (§4). No dependencies. |
| `admin/timetable/widget.js` | Decap widget `timetable`: import panel + normal object editor (§5.3) |
| `admin/timetable/preview.js` | Admin preview of a month with the site's CSS and layout (both languages, both churches) |
| `admin/index.html` | Decap CMS 3.16.3 (pinned) + the three scripts |
| `admin/config.yml` | `publish_mode: editorial_workflow`, `timetable` collection; old calendar entries and the broken "Blog Posts" entry removed |
| `_data/timetable/YYYY-MM.yml` | Month files (migrated: 2026-01, 03, 04, 05, 06, 07, 09) |
| `_includes/timetable_church.html` | Renders one church from the shared day list (`church="barbara"/"jesuit"` filters by `isJesuitenKirche`, optional `window=7`) |
| `_includes/timetable_script.html` | Shows current + next month in the browser (§5.7) |
| `_layouts/indexlayout.html`, `_includes/timetable.html` | Use the two includes above |
| `_scripts/migrate_timetable.rb` | One-time migration (§5.6) |
| `assets/timetables/` | Archived Word files |
| `_config.yml` | Excludes `specs/` and `temp/` from the site |
| Removed | `_data/{ua,de}/calendar_*.yml`, `_data/publishedMonths.yml`, `_includes/indextimetable_*.html` |

### Tests

Run `python3 specs/J-1/tests/serve.py` from the repository root and open:

- `http://127.0.0.1:8765/specs/J-1/tests/parser.html`: 70 checks against the 9 sample files in `specs/J-1/fixtures/` (all pass).
- `http://127.0.0.1:8765/specs/J-1/tests/preview.html`: shows the import of a sample or your own `.docx` per language and church, with the warnings, for reviewing a month.
- `http://127.0.0.1:8765/specs/J-1/tests/visibility.html`: 7 checks for the month selection, including December → January (all pass).
- `http://127.0.0.1:8765/specs/J-1/tests/cms.html`: the real admin config with Decap's in-memory test backend, to try the import without touching the repository.

The Liquid include was rendered with Liquid 4 (Jekyll's filters stubbed) for both languages and churches, including unquoted times. A full Jekyll build was not possible locally (Jekyll isn't installed and the system Ruby is 2.6); the Azure preview build of the pull request covers that.
