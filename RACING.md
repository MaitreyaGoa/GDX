# GDX Racing — race night guide (gdxgarage.com/race)

## How it works (simple mode)
- Every race is **1 vs 1**. The two racers agree the stake between themselves before the race (₹100 / ₹200 / ₹500 / ₹1000);
  20% goes to the track as track charges and the winner takes the rest. **None of this money is recorded on the website.**
- The website only records: the two cars, who won, and **"✓ Entry fee paid"**.
- Each car = **owner + model name** (e.g. "Rahul S. · Bone Shaker"), with its own number and permanent record.
- **No timings — only winner and loser.**
- **Points: Win +3 · Loss +1 · 🔥 every 3 wins in a row +1 bonus** (at the 3rd, 6th, 9th… straight win). The more you race, the more you can climb.
- Two leaderboards on the dashboard:
  - **🏎️ Cars** (owner + model) — races won, races raced, points. Sort "By points" or "By races won". The top car = the fastest car in Goa.
  - **👑 Owners** — all of an owner's cars added together, sorted by most races won.

## Race tracker — Race 1, 2, 3 …
- Every event starts with **30 race slots** (Race 1 … Race 30). Host: **+ Add 30 more races** whenever needed (any number of times).
- Members (signed in with Google) register a car, then tap **🏁 Join Race N** on any open race and pick their car.
  Many people can ask for the same race. They can change car or leave until the race is confirmed.
- Host picks the **two final cars** on the race card (people who asked are listed first; any car incl. walk-ins can be picked) → **✅ Confirm Race N**.
- The first confirmed race shows as **⏭️ Up next** (also on the event header).
- On the confirmed card: tick **Both racers have paid the entry fee** → tap who won → result LOCKED as "Race N".
- **↺ Change cars** re-opens a confirmed race. A raced result can't be changed — void it in Race results, then **↺ Re-run Race N**.
- Every race card shows flags so everyone knows racing is not free:
  💰 **Entry fee — pay at the track** (open/confirmed) → 💰 **Entry fee paid** (raced) · ⏳ **Waiting for admin approval** → ✅ **Admin approved · counts on leaderboard** · ❌ **Voided · not counted**.
  These are information only — no money is stored on the website.
- Tracker filters: Upcoming · Open · Confirmed · Results · My races · All.

## Before the event (host)
1. Run `supabase/8-update-racing.sql`, `supabase/9-update-racing-simple.sql` and `supabase/10-update-race-slots.sql` once in Supabase → SQL Editor.
2. Log in at admin.html → open `gdxgarage.com/race` in the SAME tab (or admin.html?next=race).
3. Race control → Event settings: name, date, venue, classes, prizes → Create event.
4. Share `gdxgarage.com/race` — racers register their cars with Google. Walk-ins: "+ Walk-in racer".

## On the night
- Big screen: **race.html?tv=1** on a laptop connected to a TV (refreshes every 5 s).
- Work down the tracker: confirm the two cars for the next race → both racers settle the stake and track charge with you
  → tick **Both racers have paid the entry fee** → tap who won on the race card. The result is LOCKED.
- Mistake? Race results → **Void** with a reason. It stays visible, struck through, and stops counting for points.
- End of night: Status → Finished.

## How results are protected
- Nobody — not even admins — can edit or delete a saved result (enforced by the database).
- Each result is sealed with SHA-256 and linked to the one before it; the page shows "✓ All N results verified — untouched".
