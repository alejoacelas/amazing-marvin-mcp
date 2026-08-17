# Amazing Marvin non-stable endpoint report

Checked 16 August 2026 against the vendor wiki and a real limited-token account.
Amazing Marvin calls stability a rough estimate; five endpoint families are labelled
experimental and the rest below have no stability label.

## Release decision

| Capability | Real result | Decision |
| --- | --- | --- |
| `/me` | Returned profile, billing, account and reward fields | Ship normalized beta read: masked email and account-ID suffix only. |
| `/children` | Returned one direct open child; preserved `dueDate` string; omitted it after completion | Ship beta read with direct/open-only wording. Empty cannot prove an invalid parent. |
| `/tracks` | Returned paired source-of-truth timestamps for tested tasks | Ship opt-in beta read. It exposes work patterns and does not imply task cache consistency. |
| `/kudos` | Returned numeric kudos, level and remaining values | Ship opt-in beta read with only those three fields. |
| `/todayTimeBlocks` | Returned the UI-created block only for its explicit local date; omitting `date` missed it after UTC midnight | Ship a normalized beta read that always sends an explicit date. Duration is minutes. DST recurrence remains untested. |
| `/habit`, `/habits` | Record, undo and history replacement worked, but reads expose no habit title or definition | Do not ship. A new habit is absent until it has history, so the model cannot map an opaque ID to a human habit. |
| `/markDone` | Plain task completed and disappeared from open children | Do not ship now. It is non-idempotent and Marvin lists missing recurring, reward, kudos and metadata behavior. |
| `/track` | START/STOP produced one timestamp pair and cleared `trackedItem` | Do not ship. Marvin says callers must also update task `times` and `duration`; that needs the full token. |
| reward claim/unclaim | Totals returned to baseline, but `rewardPointsLastDate` did not | Do not ship. “Unclaim” compensates but does not restore exact profile state. |
| reminder set/delete | Both returned `OK` using millisecond time | Do not ship. The limited token cannot list reminders to verify cleanup; docs conflict on time units elsewhere. |
| `/addEvent` | Created a 30-minute event for today; the UI immediately showed the right title, time and duration; this account had Calendar Sync off and no linked calendars | Do not ship. There is no limited-token read/delete proof, and Calendar Sync may propagate writes on other accounts. |
| habit record/undo/rewrite | Record and undo propagated to the UI; a two-entry rewrite reread exactly and restored to empty with `updateDB=true` | Do not ship. Writes work, but limited reads cannot identify habits by name and replacement overwrites all history. |
| reward spend | Not mutated | Do not ship. No limited-token inverse exists. |

Aliases `/time` and `/times` add no capability and are not separate tools.

## What was tested

Direct real calls used the documented token header, explicit dates, unique
`MCPB-QA-20260816-*` fixtures, three seconds between queries, and no automatic write
retry. The positive children fixture included a due date to reproduce the community
server's formatting failure. Timer START and STOP ran in a `finally` cleanup. A
far-future manual reminder was deleted immediately. Raw `/me` values and the token
were not printed or committed.

The MCP fake server covers success and failure shapes without real mutations:
authentication returned as HTTP 200 text, 401/403, 429, 5xx, malformed arrays, empty
tracking, timeouts after accepting a write, impossible dates, title syntax, limits,
request serialization, and secret-free errors. Each packaged beta read also passed
through the real MCP rather than only through direct HTTP.

The positive time-block test created `MCPB-QA-20260816-TIMEBLOCK` in Marvin at
22:00. `/todayTimeBlocks?date=2026-08-16` returned its ID, title, date, start time and
60-minute duration; the adjacent date and an omitted date returned no block. The
packaged beta tool passed the explicit-date read through MCP and projects only those
fields plus an optional note.

The boolean habit test exposed a less usable contract. Before its first record,
`/habits` returned no record despite the habit existing after a UI reload. After one
UI record, it returned `habitId`, history and scheduling metadata but no title,
target, type or other definition. `/habit?id=...` had the same limitation. API
record, undo and full-history replacement all updated Marvin when `updateDB=true`;
restoring `[]` then produced `history: null` in `/habits` but `history: []` in
`/habit`. This is coherent enough for a low-level ID-based client, not for a model
that needs to understand which habit the user named.

## UI verification

The signed-in disposable account showed both API-created projects and every task
created by direct API, MCP and Claude exactly once. The UI preserved literal `#`,
`@`, `+`, `~` and `^` title text and displayed the expected 5, 7, 10, 15 and 20 minute
estimates. This verifies the user-visible result, not only the API round trip.

Time Blocking and Habits began disabled and were enabled for these tests. Enabling
Time Blocking also enabled Time Block Sections. Calendar Sync was off and no
calendars were linked. A same-day event created through `/addEvent` appeared in
Marvin at 21:00–21:30, but the limited API has no event read or delete endpoint with
which to prove cleanup.

Positive time-block and boolean-habit behavior is now measured. Numeric habits,
habit reminders, time-block recurrence, DST boundaries, external calendar
propagation and reward spending remain untested.

Before promoting any excluded capability, create a disposable UI fixture, compare
the API and UI after every mutation, exercise timeout ambiguity, restore the exact
baseline, and repeat on the release-test account. A tool description can explain a
stable limitation; it cannot repair split state or provide an inverse the API lacks.

Primary source: [Amazing Marvin API wiki](https://github.com/amazingmarvin/MarvinAPI/wiki/Marvin-API).
