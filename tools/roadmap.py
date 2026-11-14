"""Build the study roadmap: steps in order of marks per hour, from zero.

Writes web/data/roadmap.json for the Plan page, and prints the roadmap as a
Markdown table with --table. Rerun it after each full paper, once the
assumptions below have been changed to match the results.

    python tools/roadmap.py           # writes web/data/roadmap.json
    python tools/roadmap.py --table   # also prints the Markdown table
"""

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "roadmap.json"

UPDATED = "2026-11-14"

SOURCES = [
    ("Career Launcher, CAT 2024 slot analyses", "https://www.careerlauncher.com/cat/analysis-cut-off/2024/slot1"),
    ("Career Launcher, CAT 2025 slot analyses", "https://www.careerlauncher.com/cat/analysis-cut-off/2025/slot1"),
    ("Cracku, CAT quant topic weightage", "https://cracku.in/cat-quant-topic-wise-weightage"),
    ("IMS, CAT 2025 overall analysis", "https://www.imsindia.com/?p=14281"),
    ("InsideIIM, CAT 2025 full analysis and expected percentiles",
     "https://insideiim.com/cat-2025-full-exam-analysis-difficulty-level-section-insights-good-attempts-and-expected-scores-vs-percentiles"),
]


def avg(xs):
    return sum(xs) / len(xs)


# QA questions per paper, over the six slots of CAT 2024 (S1 to S3) and 2025 (S1 to S3).
# First figure: Career Launcher's detailed table. Second: Cracku's weightage table.
QA_COUNTS = {
    "ratio": (avg([1, 1, 1, 1, 1, 2]) + avg([1, 1, 1, 0, 1, 1]) + avg([1, 1, 1, 1, 1, 1]),
              avg([5, 4, 3, 2, 2, 2]) + avg([0, 0, 0, 1, 1, 1])),
    "equations": (avg([2, 1, 3, 2, 2, 0]) + avg([0, 2, 0, 0, 2, 0]) + avg([0, 1, 0, 1, 0, 0]),
                  avg([1, 2, 2, 4, 4, 2]) + avg([2, 2, 0, 2, 2, 1])),
    "logs": (avg([1, 1, 1, 1, 1, 1]) + avg([0, 0, 0, 0, 0, 1]) + avg([2, 2, 1, 0, 1, 0]),
             avg([2, 2, 3, 1, 1, 1]) + avg([2, 1, 1, 2, 2, 1])),
    "tsd": (avg([1, 1, 1, 1, 1, 2]) + avg([1, 1, 1, 1, 1, 1]) + avg([0, 0, 0, 0, 0, 1]),
            avg([2, 2, 2, 2, 2, 4])),
    "percent": (avg([1, 0, 1, 1, 0, 0]) + avg([1, 2, 1, 1, 2, 1]) + avg([1, 1, 1, 1, 1, 0]),
                avg([2, 2, 3, 3, 2, 1])),
    "geometry": (avg([3, 3, 3, 4, 3, 3]), avg([2, 3, 3, 3, 3, 3])),
    "numbers": (avg([2, 2, 2, 3, 3, 3]), avg([3, 2, 3, 1, 2, 3])),
}

# Net marks per QA question on a cleared chapter: you attempt 50 to 80% of them
# and get 50 to 70% of those right. Lower for topics that run hard for beginners.
QA_RATE = (0.6, 1.5)
QA_RATE_HARD = (0.4, 1.0)

# No section's top end goes above its 90th percentile score for Slot 2 (InsideIIM, CAT 2025).
CAPS = {"VARC": 24, "DILR": 16, "QA": 16}

# Every IIM sets a minimum percentile for each section, so a section left near zero
# rules out a call whatever the total. The order brings each section to its 80th
# percentile (Slot 2, at the middle of the estimate) before taking any section past it.
PCT = json.loads((ROOT / "web" / "data" / "percentiles.json").read_text(encoding="utf-8"))
SLOT = "Slot 2 (afternoon)"
FLOOR_PCT = 80
GOAL_PCT = (90, 92)
FLOOR_SOURCES = [
    ("IIM Ahmedabad, shortlisting criteria for the 2026-28 PGP",
     "https://iima.ac.in/sites/default/files/2026-01/ShortlistingCriteria_PGP_2026-28_Jan%2009%2C%202026.pdf"),
    ("IIM Lucknow, admission policy for the 2026-28 batch",
     "https://www.iiml.ac.in/sites/default/files/upload/news/2143004504IIML%20Admission%20Policy%20Batch%202026-2028.pdf"),
    ("IIM Kozhikode, PGP admissions policy 2026-28",
     "https://iimk.ac.in/uploads/programsmenu/PGP%20Admissions%20Policy%2026-28_20251209102809.pdf"),
]


def marks_at(section, pct):
    """Raw marks at a percentile in the Slot 2 table, from the middle of each band."""
    pts = sorted((p, (lo + hi) / 2) for p, lo, hi in PCT["slots"][SLOT][section])
    for (p0, s0), (p1, s1) in zip(pts, pts[1:]):
        if p0 <= pct <= p1:
            return s0 + (pct - p0) / (p1 - p0) * (s1 - s0)
    raise ValueError(f"{pct} is outside the {section} table")


FLOORS = {k: marks_at(k.lower(), FLOOR_PCT) for k in CAPS}


def mcq(n, p):
    """Net marks from n MCQs at accuracy p: +3 right, -1 wrong."""
    return n * (4 * p - 1)


def tita(n, p):
    """Net marks from n type-in questions at accuracy p: +3 right, nothing lost."""
    return n * 3 * p


def qa(key, hard=False):
    a, b = QA_COUNTS[key]
    lo_rate, hi_rate = QA_RATE_HARD if hard else QA_RATE
    return min(a, b) * lo_rate, max(a, b) * hi_rate


def topic(tid, label):
    return {"label": label, "href": f"topics.html#{tid}"}


def test(tid, label):
    return {"label": label, "href": f"test.html?id={tid}"}


STEPS = [
    dict(id="odd-one", section="VARC", title="Odd sentence out", hours=1.5,
         gain=(tita(2, 0.4), tita(2, 0.6)), topics=["varc-odd-one"],
         why="Two type-in questions in every 2024 and 2025 paper. A wrong answer costs nothing, and the method takes an evening.",
         learn=[topic("varc-odd-one", "Videos"), test("varc-odd-one-1", "Practice set 1")],
         check={"tests": ["varc-odd-one-2"], "target": 70}),
    dict(id="rc-method", section="VARC", title="Reading comprehension: the method", hours=5,
         gain=(mcq(8, 0.4), mcq(12, 0.5)), topics=["varc-rc"],
         why="16 of the 68 questions are reading comprehension, more than any other kind, and there are no formulas to learn first.",
         learn=[topic("varc-rc", "Videos"), test("varc-rc-1", "RC set 1"), test("varc-rc-2", "RC set 2")],
         check={"tests": ["varc-rc-3"], "target": 70}),
    dict(id="summary", section="VARC", title="Para summary", hours=1.5,
         gain=(mcq(2, 0.45), mcq(2, 0.65)), topics=["varc-summary"],
         why="Two or three MCQs a paper that use the reading you just practised on RC.",
         learn=[topic("varc-summary", "Videos"), test("varc-summary-1", "Practice set 1")],
         check={"tests": ["varc-summary-2"], "target": 70}),
    dict(id="dilr-first", section="DILR", title="Your first DILR set: picking sets, tables and charts", hours=5,
         gain=(2.0, 8.0), topics=["dilr-selection", "dilr-tables"],
         why="Two or three of the five sets in a paper are tables, charts or graphs. Finishing one is worth more than starting all five.",
         learn=[topic("dilr-selection", "Picking a set in 5 minutes"), topic("dilr-tables", "Tables and charts"),
                topic("qa-percentages", "Fractions as percentages (15:40 to 28:05 in the first video)"),
                test("dilr-tables-1", "Tables set 1")],
         check={"tests": ["dilr-tables-2"], "target": 60}),
    dict(id="pj-completion", section="VARC", title="Para jumbles and para completion", hours=3.5,
         gain=(tita(2, 0.25) + mcq(2, 0.35), tita(2, 0.45) + mcq(2, 0.5)),
         topics=["varc-parajumbles", "varc-completion"],
         why="Each 2025 slot had two type-in para jumbles and two completion MCQs. Both come down to how sentences link.",
         learn=[topic("varc-parajumbles", "Para jumble videos"), topic("varc-completion", "Para completion videos")],
         check={"self": "Ten para jumbles and completion questions from CAT 2021 to 2023 papers on Cracku, with 6 or more right. A site set for this step is on its way."}),
    dict(id="rc-four", section="VARC", title="Reading comprehension: the fourth passage", hours=3,
         gain=(1.0, 4.0), topics=["varc-rc"],
         why="Four more questions, but only once three passages take you under 28 minutes. Speed comes from timed practice, not new theory.",
         learn=[topic("varc-rc", "Videos")],
         check={"self": "Four passages from one CAT 2021, 2022 or 2023 paper on Cracku in 36 minutes, with 8 or more of the 16 right."}),
    dict(id="ratio", section="QA", title="Ratio, proportion, averages and mixtures", hours=4.5,
         gain=qa("ratio"), topics=["qa-ratio", "qa-averages"],
         why="Three or four questions a paper, and the base for speed, work and mixtures later.",
         learn=[topic("qa-ratio", "Ratio"), topic("qa-averages", "Averages and mixtures"),
                test("practice-qa-ratio", "Ratio set 1"), test("practice-qa-averages", "Averages set 1")],
         check={"tests": ["practice2-qa-ratio", "practice2-qa-averages"], "target": 60}),
    dict(id="arrangements", section="DILR", title="Arrangements: linear, circular and grids", hours=3.5,
         gain=(1.0, 4.0), topics=["dilr-arrangements"],
         why="About one set a paper in 2024 and 2025 was an arrangement, so it gives you a second set type to look for.",
         learn=[topic("dilr-arrangements", "Videos and notes"), test("dilr-arrangements-1", "Arrangements set 1")],
         check={"tests": ["dilr-arrangements-2"], "target": 60}),
    dict(id="equations", section="QA", title="Linear equations, quadratics and inequalities", hours=6,
         gain=qa("equations"), topics=["qa-linear", "qa-quadratic", "qa-inequalities"],
         why="Three or four questions a paper, most of them word problems that turn into one equation.",
         learn=[topic("qa-linear", "Linear equations"), topic("qa-quadratic", "Quadratics"), topic("qa-inequalities", "Inequalities"),
                test("practice-qa-linear", "Linear set 1"), test("practice-qa-quadratic", "Quadratics set 1"),
                test("practice-qa-inequalities", "Inequalities set 1")],
         check={"tests": ["practice2-qa-linear", "practice2-qa-quadratic", "practice2-qa-inequalities"], "target": 60}),
    dict(id="logs", section="QA", title="Logs, indices and progressions", hours=5,
         gain=qa("logs"), topics=["qa-logs", "qa-progressions"],
         why="Two or three questions a paper, mostly rules you can learn in a sitting.",
         learn=[topic("qa-logs", "Logs and indices"), topic("qa-progressions", "Progressions")],
         check={"self": "Ten log, index and progression questions from CAT 2021 to 2023 papers on Cracku, with 6 or more right. A site set for this step is on its way."}),
    dict(id="tsd", section="QA", title="Speed, distance, time and work", hours=4.5,
         gain=qa("tsd"), topics=["qa-tsd", "qa-work"],
         why="About two questions a paper, nearly always one of each.",
         learn=[topic("qa-tsd", "Speed, time, distance"), topic("qa-work", "Time and work"),
                test("practice-qa-tsd", "Speed set 1"), test("practice-qa-work", "Work set 1")],
         check={"tests": ["practice2-qa-tsd", "practice2-qa-work"], "target": 60}),
    dict(id="percent", section="QA", title="Percentages, profit and loss, interest", hours=6,
         gain=qa("percent"), topics=["qa-percentages", "qa-profit-loss", "qa-interest"],
         why="Two or three questions a paper. Percentages also make every DILR chart quicker.",
         learn=[topic("qa-percentages", "Percentages"), topic("qa-profit-loss", "Profit and loss"), topic("qa-interest", "Interest"),
                test("practice-qa-percentages", "Percentages set 1"), test("practice-qa-profit-loss", "Profit set 1"),
                test("practice-qa-interest", "Interest set 1")],
         check={"tests": ["practice2-qa-percentages", "practice2-qa-profit-loss", "practice2-qa-interest"], "target": 60}),
    dict(id="venn", section="DILR", title="Venn diagrams, grouping and distribution", hours=4.5,
         gain=(1.0, 3.0), topics=["dilr-venn", "dilr-grouping"],
         why="Set-theory sets came up in two of the six slots, and grouping sets in others. Another type to look for.",
         learn=[topic("dilr-venn", "Venn diagrams"), topic("dilr-grouping", "Grouping"),
                test("dilr-venn-1", "Venn set 1"), test("dilr-grouping-1", "Grouping set 1")],
         check={"tests": ["dilr-venn-2", "dilr-grouping-2"], "target": 60}),
    dict(id="networks", section="DILR", title="Routes, networks, games and tournaments", hours=4,
         gain=(1.0, 2.0), topics=["dilr-routes", "dilr-games"],
         why="Networks came up three times in 2024 and tournaments once or twice. Worth it only once the earlier types are solid.",
         learn=[topic("dilr-routes", "Routes and networks"), topic("dilr-games", "Games and tournaments")],
         check={"self": "One set of each type from a CAT 2021 to 2023 paper on Cracku, with 3 or more right in each."}),
    dict(id="geometry", section="QA", title="Geometry and mensuration", hours=6,
         gain=qa("geometry", hard=True), topics=["qa-geometry", "qa-mensuration"],
         why="About three questions a paper, but a lot of formulas for a beginner, so it pays slowly.",
         learn=[topic("qa-geometry", "Triangles, circles, polygons"), topic("qa-mensuration", "Mensuration")],
         check={"self": "Ten geometry questions from CAT 2021 to 2023 papers on Cracku, with 5 or more right."}),
    dict(id="numbers", section="QA", title="Number system", hours=5,
         gain=qa("numbers", hard=True), topics=["qa-numbers"],
         why="Two or three questions a paper, but CAT's number questions are tricky, so a beginner gets fewer of them.",
         learn=[topic("qa-numbers", "Videos")],
         check={"self": "Ten number system questions from CAT 2021 to 2023 papers on Cracku, with 5 or more right."}),
]

# Where the four papers fall between the steps, and how far the roadmap likely gets.
PAPERS = [
    {"day": "2026-11-18", "paper": "cat-2024-s2", "title": "CAT 2024 Slot 2", "after": "dilr-first"},
    {"day": "2026-11-21", "paper": "cat-2025-s1", "title": "CAT 2025 Slot 1", "after": "rc-four"},
    {"day": "2026-11-24", "paper": "cat-2025-s2", "title": "CAT 2025 Slot 2", "after": "arrangements"},
    {"day": "2026-11-26", "paper": "cat-2025-s3", "title": "CAT 2025 Slot 3", "after": "equations"},
]
LINE = {"after": "equations",
        "text": "The roadmap likely reaches about here by 23 to 25 Nov, at about four and a half hours of new work on each learning day."}

ASSUMPTIONS = [
    "Questions per paper are averages over the six slots of CAT 2024 and 2025. For QA, where Career Launcher and Cracku disagree, the smaller count sets the low end and the larger sets the high end.",
    "Marking: +3 for a right answer, minus 1 for a wrong MCQ, nothing lost on a wrong type-in answer.",
    "QA: once a chapter is cleared you attempt 50 to 80% of its questions and get 50 to 70% of those right. Geometry and number system run harder, so they count for less.",
    "Reading comprehension: 2 or 3 passages at 40 to 50% right after the method step. The fourth passage only pays once three take under 28 minutes.",
    "Verbal: odd sentence out 40 to 60% right, para summary 45 to 65%, para jumbles 25 to 45%, para completion 35 to 50%, using CAT 2025's two of each.",
    "DILR: the first step gets you one set with 1 to 3 right. Later DILR steps make it likelier that one of the five sets is a type you know.",
    "No section's top end goes above its 90th percentile score for Slot 2 (VARC 24, DILR 16, QA 16).",
    "Hours are estimates from zero. They get revised from how long your first steps take.",
    "Left out: P&C and probability, coordinate geometry, and functions with maxima and minima. Each is likely to add under one mark in the time left.",
]

BEFORE = ("Before step 1, 20 minutes: CAT has three 40-minute sections in a fixed order (VARC, DILR, QA). "
          "A right answer is +3. A wrong MCQ is minus 1, and a wrong type-in answer costs nothing. "
          "So always answer the type-in questions, and guess an MCQ only when you're down to two options.")


def mid(step):
    return sum(step["gain"]) / 2


def order(steps):
    """Most marks per hour first, except that a section still under its floor (at the
    middle estimate) goes ahead of one that's over it. Inside a section the listed
    order holds, because later steps build on the earlier ones."""
    queues = {k: [s for s in steps if s["section"] == k] for k in CAPS}
    got = {k: 0.0 for k in CAPS}
    out = []
    while any(queues.values()):
        heads = [q[0] for q in queues.values() if q]
        pool = [h for h in heads if got[h["section"]] < FLOORS[h["section"]]] or heads
        best = max(pool, key=lambda h: (round(mid(h) / h["hours"], 6), -steps.index(h)))
        queues[best["section"]].pop(0)
        got[best["section"]] += mid(best)
        out.append(best)
    return out


def round_half_up(x):
    return int(math.floor(x + 0.5))


def build():
    lo = {s: 0.0 for s in CAPS}
    hi = {s: 0.0 for s in CAPS}
    steps = []
    for n, s in enumerate(order(STEPS), 1):
        low, high = s["gain"]
        lo[s["section"]] += low
        hi[s["section"]] += high
        run_lo = sum(lo.values())
        run_hi = sum(min(hi[k], CAPS[k]) for k in CAPS)
        steps.append({
            "n": n, "id": s["id"], "section": s["section"], "title": s["title"], "hours": s["hours"],
            "low": round(low, 2), "high": round(high, 2),
            "runLow": round(run_lo, 2), "runHigh": round(run_hi, 2),
            "value": round((low + high) / 2 / s["hours"], 2),
            "topics": s["topics"], "why": s["why"], "learn": s["learn"], "check": s["check"],
        })
    ids = {s["id"] for s in steps}
    for p in PAPERS:
        assert p["after"] in ids, p
    assert LINE["after"] in ids
    return {
        "updated": UPDATED,
        "before": BEFORE,
        "caps": CAPS,
        "assumptions": ASSUMPTIONS,
        "sources": [{"label": a, "url": b} for a, b in SOURCES],
        "goal": {
            "overallPct": list(GOAL_PCT),
            "overall": [round_half_up(marks_at("overall", p)) for p in GOAL_PCT],
            "sectionPct": FLOOR_PCT,
            "floors": {k: round(v, 1) for k, v in FLOORS.items()},
            "slot": "Slot 2",
            "sources": [{"label": a, "url": b} for a, b in FLOOR_SOURCES],
        },
        "papers": PAPERS,
        "line": LINE,
        "steps": steps,
    }


def table(data):
    rows = ["| # | Step | Section | Adds | Hours | Running score | Check |", "|---|---|---|---|---|---|---|"]
    papers = {p["after"]: p for p in data["papers"]}
    for s in data["steps"]:
        chk = s["check"]
        check = f"Site sets, {chk['target']}%" if "tests" in chk else "Marked by hand"
        rows.append(f"| {s['n']} | {s['title']} | {s['section']} | +{round_half_up(s['low'])} to +{round_half_up(s['high'])} | "
                    f"{s['hours']:g} | {round_half_up(s['runLow'])} to {round_half_up(s['runHigh'])} | {check} |")
        if s["id"] in papers:
            p = papers[s["id"]]
            rows.append(f"| | **{p['day'][8:]} Nov: {p['title']}** | | | | | |")
    return "\n".join(rows)


if __name__ == "__main__":
    data = build()
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(data['steps'])} steps")
    if "--table" in sys.argv:
        print(table(data))
