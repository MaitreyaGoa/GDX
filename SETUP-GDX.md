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
5. SQL Editor → paste `supabase/2-gdx-all-phases.sql` → **Run**. It ends with "Google seller sign-in & approvals installed".
   Already ran an older 2-gdx-all-phases.sql? Run `supabase/3-update-google-sellers.sql` and then `supabase/4-update-admins.sql` once each instead.
6. **Admins (Maitreya + Harish):** sign in once on the site with Google as Maitreya, then run the **private** `gdx-admins-PRIVATE.sql` you got in chat (it is not in this folder on purpose — never upload it).
   (Safe to run again. `supabase/parts/` has the same SQL split into steps, for reference only.)

## 2. Website config
`assets/js/config.js` → paste the GDX project's **Project URL** and **publishable key** (Project Settings → API).
Contacts and the WhatsApp community link are also set there.

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
- **Sellers**: sellers sign in with **Google only** and apply; you approve them in Admin → Sellers. Or add them yourself with their Gmail address. No seller limit, no seller passwords. Details in `SELLERS.md`.
- **Community → Partners**: + Add → logo, type (Sponsor / Offline store / Online shop / Display & storage / Customizer-service / Patron), Standard or ⭐ Featured, "Listed until" date (hides itself after), member offer, WhatsApp, Instagram, website, Maps link. Views and clicks show on each listing. Public page: `partners.html` (old `sponsors.html` links redirect).

## Running a giveaway
1. Log in at `admin.html` → Community → **Open the giveaway wheel** (same browser tab).
2. Enter the title and prize → **Spin the wheel**.
3. The database picks a random member (everyone who signed in with Google, sellers included; only the master admin is left out), the wheel lands on them and the win is recorded publicly as "First L." (e.g. "Rahul S.").
- "Leave out members who already won" is ticked by default.
- A test draw can be removed with the ✕ next to it in the Winners list (admin only).
- The wheel shows up to 40 names at a time; the draw is always from **all** members.

## Good to know
- Same-day pick & drop only appears for Goa pincodes (403…); the database also blocks it for other pincodes.
- Order codes now start with `GDX-`.
- Review `privacy.html` and `terms.html` wording before launch — I'm not a lawyer.
