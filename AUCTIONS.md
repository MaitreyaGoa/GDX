# GDX — Auctions (gdxgarage.com/auction)

## New in Nov 2026
- Opening Auctions asks **Buy or Sell**.
- **Buy** = one list of every live auction: small photo, highest bid (and who), next minimum bid, Buy Now price, time left. Search, sort (ending soonest, newest, price, most bids), "Buy Now only", ⭐ Watching, My bids, My auctions, Ended. Updates every 10 seconds and flashes a row when its bid changes.
- **One auction** = up to 6 photos (tap to zoom), all the numbers, **bid-step buttons** (+₹10 / +₹50 / +₹100 / +₹500 — tap once and your bid keeps following the highest bid + that step), − / + buttons, Buy Now, and a Facebook-style feed of every bid and comment from the start. Comments: anyone signed in; seller gets a "Seller" badge; author, seller or admin can delete. On phones a bar at the bottom always shows the highest bid and a Bid button.
- **Back** returns to the list at the same place.
- **Sell** = up to 6 photos, Google sign-in and WhatsApp number required. Sellers can add more photos later.
- Database update: `supabase/5-update-auctions.sql`.


## What it does
- Anyone signed in with Google can **start an auction**: 1 photo, title, description,
  **starting bid**, **minimum increment**, optional **Buy Now** price and **end time** (15 min – 30 days).
- Others sign in with Google and **bid**. Every bid is checked by the database:
  - must be ≥ current bid + min increment (first bid ≥ starting bid), whole rupees only
  - auction must still be running (server clock — changing the phone's time doesn't help)
  - can't bid on your own auction or outbid yourself; bids can't be withdrawn
  - two bids at the same moment are handled one after another — only the valid one is accepted
- **Anti-sniping — final 2 minutes:** each new bid must be at least **₹100 higher** (or the seller's increment if bigger),
  and every bid **resets the clock to 2 minutes**. The auction ends only after 2 minutes with no new bid.
- **Buy Now** ends it immediately. Otherwise bidding closes exactly at the end time and the **highest bidder wins**.
- After it ends, only the **winner and seller** see each other's contact (WhatsApp / email).
  Payment and delivery are arranged between them.
- Bidders are shown by their **Google name** in the bid history. Pages refresh every few seconds; a bidder who gets outbid sees a notice.
- The seller can cancel only before the first bid.

## Setup (5 minutes)
1. Supabase → SQL Editor → run `supabase/2-gdx-all-phases.sql` (after phase 8). It ends with "Auctions installed".
   Already ran it before? Run the new version again — it's safe and adds the 2-minute rule and real names.
2. Upload to GitHub: `auction.html`, the `assets` folder, the `supabase` folder → wait for the green ✓ → Ctrl+Shift+R.
3. Open `gdxgarage.com/status.html` → "Auctions update installed" ✅.
4. Test: sign in with Google on your phone → Auction → **+ Start an auction** (end time 1 day).
   Then sign in with a different Google account on another device and bid.

## Removing a bad auction (admin)
Supabase → SQL Editor:
```sql
update public.auctions set status = 'removed' where title ilike '%part of the title%';
```
