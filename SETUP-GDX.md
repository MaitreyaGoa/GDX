# GDX — Goa Diecast Exchange · setup guide (gdxgarage.com)

Built on the tested MHC Diecast code (sales, sellers, admin, Google buyer login, auctions) with:
- New **home page**: Bento tiles — **Sales** (biggest), **Auctions**, round **Giveaways**, small **Sponsors** tile at the bottom
- **GDX look**: black + neon lime from the logo, glass surfaces, dark by default with a light/dark toggle
- **Giveaways** page (`giveaway.html`): spin wheel over every member who signed in with Google
- **Sponsors / Patrons / Hot Wheels offline stores** page (`sponsors.html`), empty for now, managed from Admin
- **Real delivery charges**: Delhivery / India Post / Same-day pick & drop (Goa only), chosen at checkout
- Footer: big WhatsApp Community button + Harish and Maitreya as contacts

The old shop home is now **`shop.html`** (the Sales tile opens it). Everything inside Sales and Auctions works exactly like MHC.

---

## 1. New Supabase project (separate from MHC)
1. supabase.com → **New project** → name `GDX` → region Mumbai.
2. **SQL Editor** → paste `supabase/1-schema.sql` → **Run**.
3. **Authentication → Users → Add user** → your admin email + password → copy the user's **UID**.
4. SQL Editor → run:
   ```sql
   insert into public.admins (user_id) values ('PASTE-YOUR-UID-HERE');
   ```
5. SQL Editor → paste `supabase/2-gdx-all-phases.sql` → **Run**. It ends with "GDX community update installed".
   (Safe to run again. `supabase/parts/` has the same SQL split into steps, for reference only.)

## 2. Website config
`assets/js/config.js` → paste the GDX project's **Project URL** and **publishable key** (Project Settings → API).
Contacts, WhatsApp community link and the 25-seller limit are also set there.

## 3. Google sign-in
Same as `BUYER-LOGIN.md`, but use `gdxgarage.com` everywhere and the **GDX** project's callback URL:
`https://<your-gdx-ref>.supabase.co/auth/v1/callback`.
In Supabase → Authentication → URL Configuration: Site URL `https://www.gdxgarage.com`, Redirect URLs `https://www.gdxgarage.com/**` and `https://gdxgarage.com/**`.

## 4. Upload & check
Upload all files to the GitHub repo for gdxgarage.com (`CNAME` is already `www.gdxgarage.com`) → wait for the green ✓ → Ctrl+Shift+R.
Open `gdxgarage.com/status.html` → every line should be ✅, including **GDX community update installed**.

## 5. First things in Admin (`admin.html`)
- **My shop**: WhatsApp + UPI for your own shop.
- **Community tab** → **Delivery options & charges**: starting rates are placeholders —
  Delhivery ₹60 Goa / ₹120 India · India Post ₹50 / ₹90 · Same-day ₹150 (Goa only). Change them to your real rates and Save.
  Charges are per seller (each seller ships their own parcel). Leave "Rest of India" empty for a Goa-only option.
- **Sellers**: + Add seller (login is created with the default password `abcd`). Harish can be added here.
- **Community → Sponsors**: + Add → logo, type (Sponsor / Patron / Offline store), details, WhatsApp, Maps link.

## Running a giveaway
1. Log in at `admin.html` → Community → **Open the giveaway wheel** (same browser tab).
2. Enter the title and prize → **Spin the wheel**.
3. The database picks a random member (only Google sign-ins; seller/admin logins are excluded), the wheel lands on them and the win is recorded publicly as "First L." (e.g. "Rahul S.").
- "Leave out members who already won" is ticked by default.
- A test draw can be removed with the ✕ next to it in the Winners list (admin only).
- The wheel shows up to 40 names at a time; the draw is always from **all** members.

## Good to know
- Same-day pick & drop only appears for Goa pincodes (403…); the database also blocks it for other pincodes.
- Order codes now start with `GDX-`.
- Review `privacy.html` and `terms.html` wording before launch — I'm not a lawyer.
