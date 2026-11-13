# CAT prep group

A study site for a small group sitting CAT 2026 on 29 November 2026. It has a study timer with break reminders, practice tests in the CAT exam layout, a points board, ranked topics with videos, a mock log, and a group chat. It works on a laptop, an iPad or a phone, and can be added to a phone's home screen.

## How it fits together

- `web/` is the site. GitHub Pages serves it as plain files.
- Supabase holds the accounts and the data. The tables sit in a `private` schema the site can't read. The site only calls the `public.cat_*` functions in `supabase/schema.sql`, and only when signed in.
- Answer keys and the group code are not in this repository. They go into the database from a private folder next to it, through `tools/build_private_sql.py`.
- A sign-in stays on the device that made it. The session lives in that browser's local storage, and "Sign out of this device" ends that one session only.

## Setting it up

Whoever runs the group does this once.

1. Create a Supabase project. Under Authentication, turn off email confirmation and set the site URL to the GitHub Pages address.
2. In the SQL editor, run `supabase/schema.sql`.
3. Build the seed from the private folder, then run `seed.sql` in the SQL editor:

   ```bash
   python tools/build_private_sql.py --code "<group code>" --keys ../private/keys --out ../private/seed.sql
   ```

4. Put the project URL and the publishable key in `web/js/config.js`. The publishable key is made to be public. The secret key never goes in this repository.
5. Push to `main`. The Pages workflow publishes `web/`.

Then send the site address and the group code to the group privately. The first person to join becomes the admin and can change the code, set teams and remove members on the You page.

## Daily 5 sets

The sets for 14 to 23 November are built. For more days, add questions to the end of each topic in the private drill pool and rebuild from the same start date, which leaves the earlier days as they were:

```bash
python tools/build_tests.py --pool ../private/drill-pool --keys ../private/keys --start 2026-11-14
```

Then rebuild the seed and run it again.

## Working on it locally

```bash
npm install
npm test
npm run dev -- --demo
```

`npm test` runs the database functions on an in-memory Postgres. `npm run dev` serves the site at http://127.0.0.1:8790 with a stand-in for Supabase. Both need the private keys folder at `../private/keys` (or set `CAT_KEYS_DIR`). With `--demo`, the dev server adds three made-up members, the group code `DEV-CODE` and a four-question sample test that exists only there. Nothing is saved when it stops.

## Content

- The practice sets, the Daily 5 questions and the QA basics check were written for this group. No CAT paper is copied here. The Mocks page links to the free previous papers on Cracku instead.
- Each topic video was opened and checked against its chapters or captions on 13 or 14 November 2026.
