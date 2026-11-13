"""Write the private SQL for Supabase: the group code and the answer keys.

The output holds answers, so it is written outside the repository and must
never be committed. Run it after adding or changing a test:

    python tools/build_private_sql.py --code YOURCODE --keys ../private/keys --out ../private/seed.sql

Then paste the output file into the Supabase SQL editor and run it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "web" / "tests"


def dollar(text: str) -> str:
    tag = "$json$"
    if tag in text:
        raise SystemExit("A test contains the text $json$; change it before building.")
    return f"{tag}{text}{tag}"


def build(code: str, keys_dir: Path) -> str:
    out = [
        "-- Private data for the CAT prep site. Contains answers: do not share or commit.",
        "begin;",
    ]
    if code:
        if "'" in code:
            raise SystemExit("Keep the group code to letters, numbers and dashes.")
        out.append(
            "insert into private.config (key, value) values ('join_code', '%s') "
            "on conflict (key) do update set value = excluded.value;" % code
        )
    for path in sorted(TESTS.glob("*.json")):
        if path.name == "index.json":
            continue
        test = json.loads(path.read_text(encoding="utf-8"))
        key_path = keys_dir / f"{test['id']}.json"
        if not key_path.exists():
            raise SystemExit(f"No key for {test['id']} at {key_path}")
        key = json.loads(key_path.read_text(encoding="utf-8"))
        sections = []
        for s in test["sections"]:
            qs = []
            for q in s["questions"]:
                if q["id"] not in key:
                    raise SystemExit(f"{test['id']}: no key entry for {q['id']}")
                entry = key[q["id"]]
                if q["type"] == "mcq" and "answer" not in entry:
                    raise SystemExit(f"{test['id']}: {q['id']} has no answer")
                if q["type"] == "tita" and "answer" not in entry and not ("min" in entry and "max" in entry):
                    raise SystemExit(f"{test['id']}: {q['id']} has no answer or range")
                qs.append({"id": q["id"], "type": q["type"]})
            sections.append({"name": s["name"], "minutes": s["minutes"], "questions": qs})
        extra = set(key) - {q["id"] for s in sections for q in s["questions"]}
        if extra:
            raise SystemExit(f"{test['id']}: key has entries for unknown questions {sorted(extra)}")
        out.append(
            "insert into private.tests (test_id, title, sections, key) values (%s, %s, %s::jsonb, %s::jsonb) "
            "on conflict (test_id) do update set title = excluded.title, sections = excluded.sections, key = excluded.key;"
            % (
                dollar(test["id"]),
                dollar(test["title"]),
                dollar(json.dumps(sections, ensure_ascii=False)),
                dollar(json.dumps(key, ensure_ascii=False)),
            )
        )
    out.append("commit;")
    return "\n".join(out) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--code", default="", help="group code people type to join (leave out to keep the current one)")
    parser.add_argument("--keys", required=True, type=Path, help="folder with <test-id>.json answer keys")
    parser.add_argument("--out", type=Path, help="file to write; prints to the screen if left out")
    args = parser.parse_args()
    sql = build(args.code.strip(), args.keys)
    if args.out:
        if ROOT in args.out.resolve().parents:
            raise SystemExit("Write the private SQL outside the repository.")
        args.out.write_text(sql, encoding="utf-8")
        print(f"Wrote {args.out}")
    else:
        sys.stdout.write(sql)


if __name__ == "__main__":
    main()
