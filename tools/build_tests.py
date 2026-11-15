"""Build the Daily 5 sets and the test index.

Daily 5: five questions a day from five different topics, taken from the
private drill pool. Question text goes to web/tests/daily-YYYY-MM-DD.json;
answers go to the private keys folder, which is outside this repository.

Index: web/tests/index.json lists every test file for the Practice page.

    python tools/build_tests.py --pool ../private/drill-pool --keys ../private/keys --start 2026-11-14

To add later days from a second pool without touching the sets already built:

    python tools/build_tests.py --pool ../private/drill-pool-2 --keys ../private/keys --start 2026-11-24 --end 2026-11-28 --append
"""
import argparse
import datetime as dt
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = ROOT / "web" / "tests"
TOPIC_ORDER = ["qa-percentages", "qa-ratio", "qa-averages", "qa-profit-loss", "qa-interest",
               "qa-tsd", "qa-work", "qa-linear", "qa-quadratic", "qa-inequalities",
               "dilr-tables", "dilr-arrangements", "dilr-grouping", "dilr-venn",
               "varc-rc", "varc-odd-one", "varc-summary", "varc-parajumbles", "varc-completion"]
DAILY_TOPICS = TOPIC_ORDER[:10]


def inside_repo(path):
    try:
        path.resolve().relative_to(ROOT)
        return True
    except ValueError:
        return False


def build_daily(pool_dir, keys_dir, start, end=None):
    pools = {}
    for f in sorted(pool_dir.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        pools[data["topic"]] = list(data["questions"])
    topics = [t for t in DAILY_TOPICS if t in pools] + sorted(set(pools) - set(DAILY_TOPICS))
    n = len(topics)
    if n < 5:
        raise SystemExit("Need at least five topics in the drill pool.")
    used = {t: 0 for t in topics}
    day = start
    made = []
    while end is None or day <= end:
        # Five topics, spread out: on day i take topics i, i+2, i+4, ... (wrapping).
        i = len(made)
        picks = []
        for j in range(5):
            t = topics[(i + 2 * j + (i // n)) % n]
            if t in picks:
                t = next((x for x in topics if x not in picks and used[x] < len(pools[x])), None)
            if t is None or used[t] >= len(pools[t]):
                t = next((x for x in topics if x not in picks and used[x] < len(pools[x])), None)
            if t is None:
                break
            picks.append(t)
        if len(picks) < 5:
            break
        questions, key = [], {}
        for j, t in enumerate(picks, 1):
            q = pools[t][used[t]]
            used[t] += 1
            item = {"id": f"q{j}", "type": q["type"], "text": q["text"], "topic": t}
            if q["type"] == "mcq":
                item["options"] = q["options"]
            questions.append(item)
            key[f"q{j}"] = q["key"]
        test_id = f"daily-{day.isoformat()}"
        label = day.strftime("%a %d %b").replace(" 0", " ")
        test = {
            "id": test_id,
            "title": f"Daily 5, {label}",
            "kind": "daily",
            "day": day.isoformat(),
            "source": "original",
            "sourceNote": "Original questions written for this group. None of them is a CAT previous-year question.",
            "strict": False,
            "calculator": True,
            "instructions": [
                "5 questions, 10 minutes, CAT marking: +3 right, -1 wrong multiple choice, 0 for a wrong type-in answer.",
                "Everyone gets the same five. The ranking is by marks, then by time.",
                "Type-in answers take a number only: no %, rupee sign or units.",
            ],
            "sections": [{"name": "Daily 5", "minutes": 10, "questions": questions}],
        }
        (TESTS / f"{test_id}.json").write_text(json.dumps(test, ensure_ascii=False, indent=2), encoding="utf-8")
        (keys_dir / f"{test_id}.json").write_text(json.dumps(key, ensure_ascii=False, indent=2), encoding="utf-8")
        made.append(test_id)
        day += dt.timedelta(days=1)
    return made


def build_index():
    rank = {t: i for i, t in enumerate(TOPIC_ORDER)}
    entries = []
    for f in sorted(TESTS.glob("*.json")):
        if f.name == "index.json":
            continue
        t = json.loads(f.read_text(encoding="utf-8"))
        kind = t.get("kind", "check")
        entry = {
            "id": t["id"],
            "title": t["title"],
            "kind": kind,
            "source": t.get("source", "original"),
            "sections": [{"name": s["name"], "minutes": s["minutes"], "count": len(s["questions"])} for s in t["sections"]],
        }
        if t.get("topic"):
            entry["topic"] = t["topic"]
        if t.get("day"):
            entry["day"] = t["day"]
        for extra in ("difficulty", "opensOn"):
            if t.get(extra):
                entry[extra] = t[extra]
        entries.append(entry)
    order = {"check": 0, "practice": 1, "daily": 2}
    entries.sort(key=lambda e: (order.get(e["kind"], 3), rank.get(e.get("topic"), 99), e.get("day", ""), e["id"]))
    (TESTS / "index.json").write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(entries)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", type=pathlib.Path)
    ap.add_argument("--keys", type=pathlib.Path)
    ap.add_argument("--start", type=dt.date.fromisoformat)
    ap.add_argument("--end", type=dt.date.fromisoformat)
    ap.add_argument("--append", action="store_true", help="keep the Daily 5 sets already built")
    args = ap.parse_args()
    if args.pool:
        if not args.keys or not args.start:
            raise SystemExit("--pool needs --keys and --start too.")
        if inside_repo(args.keys) or inside_repo(args.pool):
            raise SystemExit("The drill pool and keys must stay outside the repository.")
        if args.append:
            clash = [args.start + dt.timedelta(days=i) for i in range(((args.end or args.start) - args.start).days + 1)]
            clash = [d for d in clash if (TESTS / f"daily-{d.isoformat()}.json").exists()]
            if clash:
                raise SystemExit(f"Daily 5 for {clash[0]} already exists; pick a later --start.")
        else:
            for old in TESTS.glob("daily-*.json"):
                old.unlink()
        made = build_daily(args.pool, args.keys, args.start, args.end)
        print(f"Daily 5 sets: {len(made)}, {made[0]} to {made[-1]}")
    print(f"Index: {build_index()} tests")


if __name__ == "__main__":
    main()
