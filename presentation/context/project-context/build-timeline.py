#!/usr/bin/env python3
"""
Throwaway corpus-assembler. Merges every dated, substantive event from the
FINAL PROJECT CONTEXT sources (WhatsApp, Discord, git, Linear, Trello) plus
research/milestone anchors into ONE chronological Markdown file:
    00-CHRONOLOGICAL-TIMELINE.md
Re-runnable. Deletable. Not app code.
"""
import csv, json, re, subprocess, sys
from datetime import datetime
from pathlib import Path

BASE = Path("/Users/gong/Programming/drp_02/docs/FINAL PROJECT CONTEXT")
REPO = Path("/Users/gong/Programming/drp_02")
OUT  = BASE / "00-CHRONOLOGICAL-TIMELINE.md"

events = []   # {dt, timed, source, actor, text}
counts = {}

def add(dt, source, actor, text, timed=True):
    text = (text or "").strip()
    if not text:
        return
    events.append({"dt": dt, "timed": timed, "source": source,
                   "actor": actor or "", "text": text})
    key = source.split(" ")[0]
    counts[key] = counts.get(key, 0) + 1

# ---------------------------------------------------------------- GIT
def parse_git():
    out = subprocess.run(
        ["git", "-C", str(REPO), "log", "--reverse",
         "--pretty=format:%ad\x1f%an\x1f%s",
         "--date=format:%Y-%m-%d %H:%M:%S"],
        capture_output=True, text=True).stdout
    for line in out.splitlines():
        if "\x1f" not in line:
            continue
        d, a, s = line.split("\x1f", 2)
        try:
            dt = datetime.strptime(d, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        add(dt, "GIT", a, s)

# ---------------------------------------------------------------- WHATSAPP
WA_LINE = re.compile(r'^\[(\d{2}/\d{2}/\d{4}), (\d{2}:\d{2}:\d{2})\] ([^:]+): (.*)$')
WA_SYS = re.compile(
    r'(Messages and calls are end-to-end encrypted|You created group|'
    r'You added |You removed |You changed |changed the group|changed this group|'
    r'changed their phone number|joined using this group|left$|'
    r'This message was deleted|You deleted this message|'
    r'changed to a community|added you|turned on|turned off|'
    r'pinned a message|started a call|missed (voice|video) call)')

def wa_clean(msg):
    msg = msg.replace("‎", "")
    msg = re.sub(r'<attached:[^>]+>', '[media]', msg)
    for omit in ("image omitted", "video omitted", "audio omitted",
                 "sticker omitted", "GIF omitted", "document omitted",
                 "Contact card omitted"):
        msg = msg.replace(omit, "[media]")
    msg = msg.replace("<This message was edited>", "").strip()
    return msg.strip()

def parse_whatsapp():
    path = BASE / "whatsapp" / "_chat.txt"
    cur = None
    def flush(c):
        if not c:
            return
        if c["sender"].strip() == "egg (i love claude)":
            return
        txt = wa_clean(c["msg"])
        if not txt or txt == "[media]" and len(c["msg"]) < 12:
            if txt != "[media]":
                return
        if WA_SYS.search(c["msg"]):
            return
        add(c["dt"], "WHATSAPP", c["sender"].strip(), txt)
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.replace("‎", "")
        m = WA_LINE.match(line)
        if m:
            flush(cur)
            date, tm, sender, msg = m.groups()
            try:
                dt = datetime.strptime(date + " " + tm, "%d/%m/%Y %H:%M:%S")
            except ValueError:
                cur = None
                continue
            cur = {"dt": dt, "sender": sender, "msg": msg}
        elif cur is not None:
            cur["msg"] += " " + raw.strip()
    flush(cur)

# ---------------------------------------------------------------- DISCORD
DC_HEAD = re.compile(r'^\[(\d{1,2}/\d{1,2}/\d{4})[\s ]+(\d{1,2}:\d{2})[\s ]+(AM|PM)\] (.+)$')
DC_SKIP_CHANNELS = {"gifs"}
DC_SYS = ("Joined the server.", "Pinned a message.", "Left the server.",
          "Started a call", "Added ", "Removed ", "Changed ")

def dc_keep_line(ln):
    s = ln.strip()
    if not s:
        return False
    if s.startswith("{"):                      # {Attachments} {Embed} {Reactions}...
        return False
    if re.match(r'^https?://\S+$', s):         # bare URL line
        return False
    if s in ("Joined the server.", "Pinned a message.", "Left the server."):
        return False
    if s.startswith(("Started a call",)):
        return False
    return True

def parse_discord():
    for f in sorted((BASE / "discord").glob("*.txt")):
        name = f.name
        if "Voice channels" in name:
            continue
        cm = re.search(r'Text channels - (.+?) \[', name)
        chan = cm.group(1) if cm else "unknown"
        if chan in DC_SKIP_CHANNELS:
            continue
        lines = f.read_text(encoding="utf-8").splitlines()
        cur = None
        def flush(c):
            if not c:
                return
            body = "\n".join(l for l in c["lines"] if dc_keep_line(l)).strip()
            if not body:
                return
            add(c["dt"], f"DISCORD #{chan}", c["author"], body)
        for ln in lines[4:]:                    # skip header block
            m = DC_HEAD.match(ln)
            if m:
                flush(cur)
                d, t, ap, author = m.groups()
                try:
                    dt = datetime.strptime(f"{d} {t} {ap}", "%m/%d/%Y %I:%M %p")
                except ValueError:
                    cur = None
                    continue
                cur = {"dt": dt, "author": author.strip(), "lines": []}
            elif cur is not None:
                cur["lines"].append(ln)
        flush(cur)

# ---------------------------------------------------------------- LINEAR
LIN_DATE = re.compile(r'^(\w{3} \w{3} \d{1,2} \d{4} \d{2}:\d{2}:\d{2})')

def lin_dt(s):
    if not s:
        return None
    m = LIN_DATE.match(s.strip())
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%a %b %d %Y %H:%M:%S")
    except ValueError:
        return None

def parse_linear():
    path = BASE / "linear" / "LINEAR.csv"
    with path.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            iid = row.get("ID", "").strip()
            title = (row.get("Title") or "").strip()
            status = (row.get("Status") or "").strip()
            creator = (row.get("Creator") or "").split("@")[0]
            assignee = (row.get("Assignee") or "").split("@")[0]
            labels = (row.get("Labels") or "").strip().strip('"')
            desc = (row.get("Description") or "").strip()
            created = lin_dt(row.get("Created"))
            completed = lin_dt(row.get("Completed"))
            meta = f"[{status}]"
            if labels:
                meta += f" ({labels})"
            head = f'{iid} "{title}" {meta}'
            if assignee:
                head += f" — assignee {assignee}"
            body = head
            if desc:
                body += "\n" + desc
            if created:
                add(created, "LINEAR", creator, body)
            if completed and status.lower() in ("done", "completed"):
                add(completed, "LINEAR✓", "", f'{iid} "{title}" completed')

# ---------------------------------------------------------------- TRELLO
def trello_dt(s):
    if not s:
        return None
    try:
        return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None

def parse_trello():
    data = json.loads((BASE / "trello" / "TRELLO.json").read_text(encoding="utf-8"))
    for a in data.get("actions", []):
        dt = trello_dt(a.get("date"))
        if not dt:
            continue
        who = (a.get("memberCreator") or {}).get("fullName", "")
        t = a.get("type")
        d = a.get("data", {})
        card = (d.get("card") or {}).get("name", "")
        if t == "createCard":
            txt = f'created card "{card}" in list "{(d.get("list") or {}).get("name","")}"'
        elif t == "commentCard":
            txt = f'comment on "{card}": {d.get("text","")}'
        elif t == "updateCard" and d.get("listAfter"):
            txt = (f'moved "{card}": {(d.get("listBefore") or {}).get("name","")}'
                   f' -> {(d.get("listAfter") or {}).get("name","")}')
        elif t == "createList":
            txt = f'created list "{(d.get("list") or {}).get("name","")}"'
        else:
            continue
        add(dt, "TRELLO", who, txt)

def trello_snapshot():
    data = json.loads((BASE / "trello" / "TRELLO.json").read_text(encoding="utf-8"))
    lists = {l["id"]: l["name"] for l in data.get("lists", []) if not l.get("closed")}
    by_list = {}
    for c in data.get("cards", []):
        if c.get("closed"):
            continue
        ln = lists.get(c.get("idList"))
        if not ln:
            continue
        by_list.setdefault(ln, []).append(c)
    out = []
    for ln, cards in by_list.items():
        out.append(f"\n**{ln}**")
        for c in cards:
            desc = (c.get("desc") or "").strip().replace("\n", " ")
            out.append(f"- {c['name']}" + (f" — {desc}" if desc else ""))
    return "\n".join(out) if out else "(no open cards)"

# ---------------------------------------------------------------- ANCHORS
def parse_anchors():
    A = [
        ("2026-03-13", "MILESTONE", "", "Team WhatsApp group 'egg' created - project ideation / brief selection begins"),
        ("2026-05-19", "RESEARCH", "", "Friend Meetup Dynamics Survey launched (n=43 responses, collected 19-20 May) -> drp-context/Friend Meetup Dynamics Survey ....csv"),
        ("2026-05-22", "MILESTONE", "", "M1 Elevator Pitch due (pre-recorded 3-min)"),
        ("2026-05-26", "RESEARCH", "", "Initial interviews conducted (~this week): Luca, Luke [EXPORT EMPTY], Matthew, Noah's friend -> drp-context/interviews/initial interviews/"),
        ("2026-05-29", "MILESTONE", "", "M2 Concept Development / Walking Skeleton review"),
        ("2026-06-02", "MILESTONE", "", "Law Case-Study TRA due"),
        ("2026-06-03", "RESEARCH", "", "M3 iteration interviews (~this week): Felicity, Tom, Luca (think-aloud) -> drp-context/interviews/m3 interviews (iteration)/"),
        ("2026-06-05", "MILESTONE", "", "M3 Thin-Slicing review"),
        ("2026-06-11", "RESEARCH", "", "M4 interviews (~this week): Luca, Nathan (think-aloud usability) -> drp-context/interviews/m4 interviews/"),
        ("2026-06-12", "MILESTONE", "", "M4 Quantitative Evaluation review"),
        ("2026-06-16", "MILESTONE", "", "Final Demonstrations & Presentations (16-17 Jun)"),
        ("2026-06-19", "MILESTONE", "", "Project Documentation deadline 19:00"),
    ]
    for d, src, who, txt in A:
        add(datetime.strptime(d, "%Y-%m-%d"), src, who, txt, timed=False)

# ---------------------------------------------------------------- EMIT
HEADER = """# BeThere - Master Chronological Project Context

*Auto-assembled corpus for writing the DRP Project Documentation: the **HCD Techniques Portfolio (80%)**, the **Project Pitch Leaflet (10%)**, and the **Copyright/Legal Issues Report (10%)**.*

This file interleaves every dated, substantive event from the team's working record - WhatsApp, Discord, git commits, Linear issues, Trello - into one timeline, plus research/milestone anchors. Whole-document artifacts (interview transcripts, the survey, slide decks, course rubrics, repo docs) are **not** inlined; they are indexed in the Appendix for the doc-generation step to open directly.

## Team roster (alias map) - the 4 team members
- **Gong** - Nelson Gong / Leixin Gong (WhatsApp) | gong8 (Discord) | gonglx8 (Linear) | gong-queue
- **Lukas** - luCas traCimas (WhatsApp, stylized) | lxkast (Discord) | lukastrakim (Linear) | lukas-queue
- **Noah** - Noah Seymour (WhatsApp) | seventhspark_40504 (Discord) | noah-queue
- **James** - James Hughff (WhatsApp) | the_jlh (Discord) | james.lee.hughff (Linear) | james-queue
- *"egg (i love claude)"* = WhatsApp group/system actor, not a person (filtered out)

> **Do not confuse team members with research participants.** Names like Luca Morgan, Tom Carvell, Zack Foreman, Felicity Turner, Fangyi Lin, Will Groves, Thomas Gonzalez, Nathan, Matthew are **interviewees / usability-test users** (quoted in the Trello cards and interview transcripts), NOT the team.

## Source legend
`[WHATSAPP]` team group chat | `[DISCORD #chan]` server channel | `[GIT]` commit | `[LINEAR]` issue opened | `[LINEAR-done]` issue completed | `[TRELLO]` board activity | `[MILESTONE]` course deadline | `[RESEARCH]` user-research event

## Which source feeds which document
- **HCD Portfolio (80%)** - everything here: the design-decision arc (WhatsApp/Discord/Linear/git), pivots and what was cut, the survey + interviews (Appendix), the Trello User-Need/Interaction/UI framing, and finding-to-change traceability.
- **Pitch Leaflet (10%)** - the origin/problem story (March-May WhatsApp ideation and brief selection), the value proposition, and target-audience discussion.
- **Copyright/Legal Report (10%)** - least served by chronology; rely on the codebase dependency tree (package.json files) plus any data/privacy/third-party threads (Clerk, hosting, GDPR) that surface below.

## Caveats / data gaps
- `drp-context/interviews/initial interviews/luke interview.txt` exported **EMPTY (0 bytes)** - transcript lost; recover from source if it still exists.
- Linear CSV carries issue **descriptions but no comments**; the Trello export has **no card comments**. Real decision threads therefore live in WhatsApp/Discord.
- Interview anchor dates are **approximate** (transcripts carry no timestamp); placed by iteration phase.
- Pure media / gif / embed / bare-URL posts are stripped - this is the substantive-text view, not a byte-for-byte dump.
"""

def emit():
    events.sort(key=lambda e: e["dt"])
    span_lo = events[0]["dt"].date()
    span_hi = events[-1]["dt"].date()
    stat = " | ".join(f"{k} {v}" for k, v in sorted(counts.items()))
    lines = [HEADER]
    lines.append(f"## Coverage\n**Span:** {span_lo} -> {span_hi}  |  **{len(events)} events**  |  {stat}\n")
    lines.append("---\n\n# Timeline\n")
    cur_day = None
    for e in events:
        day = e["dt"].strftime("%Y-%m-%d (%A)")
        if day != cur_day:
            cur_day = day
            lines.append(f"\n## {day}\n")
        tm = "  -  " if not e["timed"] else e["dt"].strftime("%H:%M")
        actor = f" **{e['actor']}**" if e["actor"] else ""
        txt = e["text"]
        tag = e["source"].replace("✓", "-done")
        if "\n" in txt:
            first, rest = txt.split("\n", 1)
            block = "\n".join("  > " + l for l in rest.splitlines())
            lines.append(f"- `{tm}` `[{tag}]`{actor}: {first}\n{block}")
        else:
            lines.append(f"- `{tm}` `[{tag}]`{actor}: {txt}")
    # appendix
    lines.append("\n\n---\n\n# Appendix - whole-document artifacts (open these directly)\n")
    lines.append("""### User research
- **Survey (n=43):** `drp-context/Friend Meetup Dynamics Survey (Responses) - Form Responses 1.csv`
- **Initial interviews:** `drp-context/interviews/initial interviews/` - luca, luke *(EMPTY)*, matthew, noah's friend
- **M3 iteration interviews:** `drp-context/interviews/m3 interviews (iteration)/` - felicity, tom, luca (think-aloud)
- **M4 interviews:** `drp-context/interviews/m4 interviews/` - luca, nathan (think-aloud usability)

### Formal deliverables (slide decks, PDF)
- `presentations/DRP Milestone 1.pdf` ... `DRP Milestone 4.pdf`
- `drp-context/FINAL DRP WEEK 1 PITCH.pdf`

### Course rubric & guidance
- `drp-context/DRP resources (imperial) IMPORTANT/` - Assessment Template, Playbooks, HCD theory & workshop slides
- `edstem/` - 140 course Q&A threads. Most doc-relevant: problem-statement, how-might-we, project-pitch-leaflet, impact-asset, metrics, hcd-portfolio examples, copyright-and-ndas

### Repo documentation (in the codebase, not this folder)
- `ARCHITECTURE.md`, `CLAUDE.md`, `CONTRIBUTING.md`
- `docs/m4/` - already-drafted deliverables (HCD portfolio, leaflet, legal report, quantitative eval, cover story)
- `docs/summary/` - 20+ dated session summaries (a ready-made narrative of the build)
""")
    lines.append("### Trello board snapshot (open cards by list)")
    lines.append(trello_snapshot())
    OUT.write_text("\n".join(lines), encoding="utf-8")

# ---------------------------------------------------------------- MAIN
if __name__ == "__main__":
    parse_git()
    parse_whatsapp()
    parse_discord()
    parse_linear()
    parse_trello()
    parse_anchors()
    if not events:
        sys.exit("no events parsed")
    emit()
    print(f"WROTE {OUT}")
    print("counts:", counts)
    print(f"total events: {len(events)}")
