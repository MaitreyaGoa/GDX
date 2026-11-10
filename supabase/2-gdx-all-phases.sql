-- =====================================================================
--  GDX — STEP 3 of setup: everything after the base schema, in one go.
--  Run in Supabase → SQL Editor AFTER 1-schema.sql and AFTER you added
--  yourself to public.admins (see SETUP-GDX.md). Safe to run again.
-- =====================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> phase3.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =====================================================================
--  GDX — Phase 3 (admin panel) small update
--  Run once in Supabase → SQL Editor. Safe to run more than once.
-- =====================================================================

-- Let the admin page check "am I the admin?" after logging in
grant execute on function public.is_admin() to anon, authenticated;

-- Faster admin order list / search
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_phone_idx   on public.orders (phone);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> phase6-categories.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =====================================================================
--  GDX — categories update
--  Run once in Supabase → SQL Editor. Safe to run more than once.
-- =====================================================================

-- Category of each car (used by the shop menu and filters)
alter table public.products
  add column if not exists category text;

alter table public.products drop constraint if exists products_category_check;
alter table public.products
  add constraint products_category_check
  check (category is null or category in ('Mainline', 'Premium', 'Chase', 'Pre-owned', 'Accessory'));

create index if not exists products_category_idx on public.products (category);

-- Existing cars: treat them as Mainline until you change them in admin
update public.products set category = 'Mainline' where category is null;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> phase7-sellers.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =====================================================================
--  GDX — multi-seller update (1 master admin + sellers)
--  Run ONCE in Supabase → SQL Editor, after phase6-categories.sql.
--  Safe to run again.
-- =====================================================================

-- ---------- 1. SELLERS ------------------------------------------------
create table if not exists public.sellers (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid unique references auth.users(id) on delete set null,  -- their login
  login_email          text,
  shop_name            text not null,
  whatsapp             text not null,                -- 10-digit or 91XXXXXXXXXX
  upi_id               text,
  payee_name           text,
  qr_image_url         text,
  outside_goa_shipping numeric(10,2) not null default 100 check (outside_goa_shipping >= 0),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.sellers enable row level security;

-- The seller row of whoever is logged in (null for buyers / master without a shop)
create or replace function public.my_seller_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.sellers where user_id = auth.uid() and is_active limit 1;
$$;

-- Who am I? Used by the admin page after login.
create or replace function public.my_profile()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', case when public.is_admin() then 'admin'
                 when exists (select 1 from public.sellers where user_id = auth.uid() and is_active) then 'seller'
                 else null end,
    'seller', (select to_jsonb(s) from public.sellers s where s.user_id = auth.uid() limit 1));
$$;

-- Buyers may read only the public columns (never user_id / login email)
revoke all on public.sellers from anon;
revoke all on public.sellers from authenticated;
grant select (id, shop_name, whatsapp, upi_id, payee_name, qr_image_url, outside_goa_shipping, is_active)
  on public.sellers to anon, authenticated;
grant insert, update, delete on public.sellers to authenticated;

-- Full seller list (incl. login email) for the master only
create or replace function public.admin_list_sellers()
returns setof public.sellers language sql stable security definer set search_path = public as $$
  select * from public.sellers where public.is_admin() order by created_at;
$$;
grant execute on function public.admin_list_sellers() to authenticated;

drop policy if exists "Read active sellers" on public.sellers;
create policy "Read active sellers" on public.sellers
  for select using (is_active or public.is_admin() or user_id = auth.uid());

drop policy if exists "Master adds sellers" on public.sellers;
create policy "Master adds sellers" on public.sellers
  for insert with check (public.is_admin());

drop policy if exists "Master deletes sellers" on public.sellers;
create policy "Master deletes sellers" on public.sellers
  for delete using (public.is_admin());

drop policy if exists "Seller edits own shop, master edits all" on public.sellers;
create policy "Seller edits own shop, master edits all" on public.sellers
  for update using (public.is_admin() or user_id = auth.uid())
  with check (public.is_admin() or user_id = auth.uid());

-- Sellers can't change their login link or switch themselves on/off
create or replace function public.sellers_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and not public.is_admin() then
    if new.user_id is distinct from old.user_id or new.is_active is distinct from old.is_active
       or new.login_email is distinct from old.login_email then
      raise exception 'Only the master admin can change login or active status';
    end if;
  end if;
  new.whatsapp := regexp_replace(coalesce(new.whatsapp, ''), '\D', '', 'g');
  if length(new.whatsapp) = 12 and new.whatsapp like '91%' then new.whatsapp := substr(new.whatsapp, 3); end if;
  if new.whatsapp !~ '^[6-9][0-9]{9}$' then raise exception 'Please enter a valid 10-digit WhatsApp number'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sellers_guard on public.sellers;
create trigger sellers_guard before insert or update on public.sellers
  for each row execute function public.sellers_guard();

-- Master links a seller to a login created in Authentication → Users
create or replace function public.admin_link_seller(p_seller uuid, p_email text)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception 'Only the master admin can do this'; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_uid is null then
    raise exception 'No login found for %. Create it first in Supabase → Authentication → Users.', p_email;
  end if;
  if exists (select 1 from public.sellers where user_id = v_uid and id <> p_seller) then
    raise exception 'That login is already linked to another seller';
  end if;
  update public.sellers set user_id = v_uid, login_email = lower(trim(p_email)) where id = p_seller;
  return 'linked';
end $$;

grant execute on function public.my_seller_id() to anon, authenticated;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.admin_link_seller(uuid, text) to authenticated;

-- Master's own shop: created from the current Settings (UPI, WhatsApp, shipping)
insert into public.sellers (user_id, login_email, shop_name, whatsapp, upi_id, payee_name, qr_image_url, outside_goa_shipping)
select a.user_id, u.email, coalesce(s.store_name, 'GDX'),
       coalesce(nullif(s.whatsapp_number, ''), '7358425108'), s.upi_id, s.payee_name, s.qr_image_url,
       coalesce(s.outside_goa_shipping, 100)
from public.admins a
join auth.users u on u.id = a.user_id
cross join public.settings s
where s.id = 1
  and not exists (select 1 from public.sellers x where x.user_id = a.user_id)
limit 1;

-- ---------- 2. PRODUCTS belong to a seller -----------------------------
alter table public.products add column if not exists seller_id uuid references public.sellers(id) on delete set null;
create index if not exists products_seller_idx on public.products (seller_id);
update public.products set seller_id = (select s.id from public.sellers s join public.admins a on a.user_id = s.user_id limit 1)
 where seller_id is null;

drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products" on public.products
  for select using (
    (is_active and (seller_id is null or exists (select 1 from public.sellers s where s.id = seller_id and s.is_active)))
    or public.is_admin() or seller_id = public.my_seller_id());

drop policy if exists "Admin manages products" on public.products;
drop policy if exists "Master or owner adds products" on public.products;
create policy "Master or owner adds products" on public.products
  for insert with check (public.is_admin() or (seller_id is not null and seller_id = public.my_seller_id()));
drop policy if exists "Master or owner edits products" on public.products;
create policy "Master or owner edits products" on public.products
  for update using (public.is_admin() or seller_id = public.my_seller_id())
  with check (public.is_admin() or seller_id = public.my_seller_id());
drop policy if exists "Master or owner deletes products" on public.products;
create policy "Master or owner deletes products" on public.products
  for delete using (public.is_admin() or seller_id = public.my_seller_id());

-- ---------- 3. ORDERS belong to a seller -------------------------------
alter table public.orders add column if not exists seller_id uuid references public.sellers(id) on delete set null;
create index if not exists orders_seller_idx on public.orders (seller_id, status, created_at desc);
update public.orders set seller_id = (select s.id from public.sellers s join public.admins a on a.user_id = s.user_id limit 1)
 where seller_id is null;

drop policy if exists "Seller reads own orders" on public.orders;
create policy "Seller reads own orders" on public.orders
  for select using (seller_id = public.my_seller_id());
drop policy if exists "Seller updates own orders" on public.orders;
create policy "Seller updates own orders" on public.orders
  for update using (seller_id = public.my_seller_id()) with check (seller_id = public.my_seller_id());

-- ---------- 4. PLACE ORDER: one order per seller -----------------------
-- (old 4-argument version replaced; the shop calls this once per seller in the cart)
drop function if exists public.place_order(jsonb, jsonb, text, text);
create or replace function public.place_order(
  p_customer        jsonb,
  p_items           jsonb,
  p_screenshot_path text,
  p_utr             text default null,
  p_seller_id       uuid default null
)
returns table (out_code text, out_total numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_item     jsonb;
  v_prod     public.products%rowtype;
  v_qty      int;
  v_subtotal numeric := 0;
  v_lines    jsonb := '[]'::jsonb;
  v_pincode  text := trim(coalesce(p_customer->>'pincode',''));
  v_phone    text := regexp_replace(coalesce(p_customer->>'phone',''), '\D', '', 'g');
  v_seller   uuid := p_seller_id;
  v_ship_out numeric;
  v_is_goa   boolean;
  v_shipping numeric;
  v_total    numeric;
  v_code     text;
begin
  if length(v_phone) = 12 and v_phone like '91%' then v_phone := substr(v_phone, 3); end if;
  if coalesce(trim(p_customer->>'name'),'') = '' then raise exception 'Please enter your name'; end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Please enter a valid 10-digit mobile number'; end if;
  if coalesce(trim(p_customer->>'address'),'') = '' then raise exception 'Please enter your address'; end if;
  if v_pincode !~ '^[1-9][0-9]{5}$' then raise exception 'Please enter a valid 6-digit pincode'; end if;
  if coalesce(p_screenshot_path,'') = '' then raise exception 'Payment screenshot is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then raise exception 'Invalid quantity in cart'; end if;

    select * into v_prod from public.products
      where id = (v_item->>'id')::uuid and is_active
      for update;
    if not found then raise exception 'A car in your cart is no longer available'; end if;
    if v_seller is null then v_seller := v_prod.seller_id; end if;
    if v_prod.seller_id is distinct from v_seller then
      raise exception 'Cars from different sellers must be paid separately';
    end if;
    if v_prod.stock < v_qty then
      raise exception 'Sorry, only % left of %', v_prod.stock, v_prod.name;
    end if;

    update public.products set stock = stock - v_qty, updated_at = now() where id = v_prod.id;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'id', v_prod.id, 'name', v_prod.name, 'price', v_prod.price,
      'qty', v_qty, 'image', v_prod.images[1]);
  end loop;

  select outside_goa_shipping into v_ship_out from public.sellers where id = v_seller and is_active;
  if v_seller is not null and v_ship_out is null then raise exception 'This seller is not taking orders right now'; end if;
  if v_ship_out is null then select outside_goa_shipping into v_ship_out from public.settings where id = 1; end if;

  v_is_goa   := v_pincode like '403%';
  v_shipping := case when v_is_goa then 0 else coalesce(v_ship_out, 0) end;
  v_total    := v_subtotal + v_shipping;
  v_code     := 'GDX-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.orders (order_code, seller_id, customer_name, phone, email, address, city, state, pincode,
                             is_goa, items, subtotal, shipping, total, utr, screenshot_path)
  values (v_code, v_seller, trim(p_customer->>'name'), v_phone, nullif(trim(p_customer->>'email'),''),
          trim(p_customer->>'address'), nullif(trim(p_customer->>'city'),''),
          nullif(trim(p_customer->>'state'),''), v_pincode, v_is_goa, v_lines,
          v_subtotal, v_shipping, v_total, nullif(trim(p_utr),''), p_screenshot_path);

  return query select v_code, v_total;
end $$;
grant execute on function public.place_order(jsonb, jsonb, text, text, uuid) to anon, authenticated;

-- ---------- 5. ORDER STATUS now includes the seller ---------------------
drop function if exists public.get_order_status(text, text);
create or replace function public.get_order_status(p_code text, p_phone text)
returns table (order_code text, status text, items jsonb, subtotal numeric, shipping numeric,
               total numeric, tracking_number text, created_at timestamptz,
               seller_name text, seller_whatsapp text)
language sql stable security definer set search_path = public as $$
  select o.order_code, o.status, o.items, o.subtotal, o.shipping, o.total, o.tracking_number, o.created_at,
         s.shop_name, s.whatsapp
  from public.orders o
  left join public.sellers s on s.id = o.seller_id
  where upper(o.order_code) = upper(trim(p_code))
    and o.phone = right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
$$;
grant execute on function public.get_order_status(text, text) to anon, authenticated;

-- ---------- 6. FILES: sellers upload photos & QR; see own screenshots ----
drop policy if exists "Admin uploads product images and site assets" on storage.objects;
create policy "Admin uploads product images and site assets" on storage.objects
  for insert with check (bucket_id in ('product-images','site-assets')
                         and (public.is_admin() or public.my_seller_id() is not null));

drop policy if exists "Admin edits product images and site assets" on storage.objects;
create policy "Admin edits product images and site assets" on storage.objects
  for update using (bucket_id in ('product-images','site-assets') and (public.is_admin() or owner = auth.uid()));

drop policy if exists "Admin deletes files" on storage.objects;
create policy "Admin deletes files" on storage.objects
  for delete using ((bucket_id in ('product-images','site-assets','payment-screenshots') and public.is_admin())
                    or (bucket_id in ('product-images','site-assets') and owner = auth.uid()));

drop policy if exists "Only admin views payment screenshots" on storage.objects;
create policy "Only admin views payment screenshots" on storage.objects
  for select using (bucket_id = 'payment-screenshots' and (
    public.is_admin()
    or exists (select 1 from public.orders o where o.screenshot_path = storage.objects.name
                                              and o.seller_id = public.my_seller_id())));

-- =====================================================================
--  ADDING A SELLER (repeat for each, up to 5):
--  1. Authentication → Users → Add user → their email + password → Auto Confirm.
--  2. Admin panel → Sellers → Add seller → shop name, WhatsApp, their email.
-- =====================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> phase8-buyers.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =====================================================================
--  GDX — buyer accounts (Sign in with Google)
--  Run ONCE in Supabase → SQL Editor, after phase7-sellers.sql.
--  Safe to run again.
-- =====================================================================

-- ---------- 1. PROFILES (one per buyer) --------------------------------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  phone      text check (phone is null or phone ~ '^[6-9][0-9]{9}$'),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
drop policy if exists "Buyer manages own profile" on public.profiles;
create policy "Buyer manages own profile" on public.profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Fill the profile automatically from Google on first sign-in
create or replace function public.handle_new_buyer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, full_name, email, avatar_url)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.email,
          coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'))
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
  for each row execute function public.handle_new_buyer();

-- ---------- 2. SAVED ADDRESSES ------------------------------------------
create table if not exists public.addresses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  phone      text not null check (phone ~ '^[6-9][0-9]{9}$'),
  address    text not null,
  city       text,
  state      text,
  pincode    text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists addresses_user_idx on public.addresses (user_id, created_at desc);
alter table public.addresses enable row level security;
revoke all on public.addresses from anon;
drop policy if exists "Buyer manages own addresses" on public.addresses;
create policy "Buyer manages own addresses" on public.addresses
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 3. SAVED CART (same cart on every device) --------------------
create table if not exists public.cart_items (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  qty        int  not null check (qty between 1 and 20),
  added_at   timestamptz not null default now(),
  primary key (user_id, product_id)
);
alter table public.cart_items enable row level security;
revoke all on public.cart_items from anon;
drop policy if exists "Buyer manages own cart" on public.cart_items;
create policy "Buyer manages own cart" on public.cart_items
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Replace the whole cart in one step (the website sends the full list)
create or replace function public.save_cart(p_items jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from public.cart_items c
   where c.user_id = auth.uid()
     and c.product_id not in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x);
  insert into public.cart_items (user_id, product_id, qty)
  select auth.uid(), (x->>'id')::uuid, least(greatest((x->>'qty')::int, 1), 20)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
   where exists (select 1 from public.products p where p.id = (x->>'id')::uuid)
  on conflict (user_id, product_id) do update set qty = excluded.qty;
end $$;
revoke execute on function public.save_cart(jsonb) from anon;
grant execute on function public.save_cart(jsonb) to authenticated;

-- ---------- 4. ORDERS belong to the buyer ------------------------------
alter table public.orders add column if not exists buyer_id uuid references auth.users(id) on delete set null;
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);
drop policy if exists "Buyer reads own orders" on public.orders;
create policy "Buyer reads own orders" on public.orders
  for select to authenticated using (buyer_id = auth.uid());

-- Orders now require a signed-in buyer (same arguments as before)
create or replace function public.place_order(
  p_customer        jsonb,
  p_items           jsonb,
  p_screenshot_path text,
  p_utr             text default null,
  p_seller_id       uuid default null
)
returns table (out_code text, out_total numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_item     jsonb;
  v_prod     public.products%rowtype;
  v_qty      int;
  v_subtotal numeric := 0;
  v_lines    jsonb := '[]'::jsonb;
  v_pincode  text := trim(coalesce(p_customer->>'pincode',''));
  v_phone    text := regexp_replace(coalesce(p_customer->>'phone',''), '\D', '', 'g');
  v_seller   uuid := p_seller_id;
  v_ship_out numeric;
  v_is_goa   boolean;
  v_shipping numeric;
  v_total    numeric;
  v_code     text;
  v_buyer    uuid := auth.uid();
begin
  if v_buyer is null then raise exception 'Please sign in with Google to place your order'; end if;
  if exists (select 1 from public.sellers s where s.user_id = v_buyer) or public.is_admin() then
    raise exception 'Seller and admin accounts cannot place orders. Sign in with a buyer Google account.';
  end if;
  if length(v_phone) = 12 and v_phone like '91%' then v_phone := substr(v_phone, 3); end if;
  if coalesce(trim(p_customer->>'name'),'') = '' then raise exception 'Please enter your name'; end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Please enter a valid 10-digit mobile number'; end if;
  if coalesce(trim(p_customer->>'address'),'') = '' then raise exception 'Please enter your address'; end if;
  if v_pincode !~ '^[1-9][0-9]{5}$' then raise exception 'Please enter a valid 6-digit pincode'; end if;
  if coalesce(p_screenshot_path,'') = '' then raise exception 'Payment screenshot is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then raise exception 'Invalid quantity in cart'; end if;

    select * into v_prod from public.products
      where id = (v_item->>'id')::uuid and is_active
      for update;
    if not found then raise exception 'A car in your cart is no longer available'; end if;
    if v_seller is null then v_seller := v_prod.seller_id; end if;
    if v_prod.seller_id is distinct from v_seller then
      raise exception 'Cars from different sellers must be paid separately';
    end if;
    if v_prod.stock < v_qty then
      raise exception 'Sorry, only % left of %', v_prod.stock, v_prod.name;
    end if;

    update public.products set stock = stock - v_qty, updated_at = now() where id = v_prod.id;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'id', v_prod.id, 'name', v_prod.name, 'price', v_prod.price,
      'qty', v_qty, 'image', v_prod.images[1]);
  end loop;

  select outside_goa_shipping into v_ship_out from public.sellers where id = v_seller and is_active;
  if v_seller is not null and v_ship_out is null then raise exception 'This seller is not taking orders right now'; end if;
  if v_ship_out is null then select outside_goa_shipping into v_ship_out from public.settings where id = 1; end if;

  v_is_goa   := v_pincode like '403%';
  v_shipping := case when v_is_goa then 0 else coalesce(v_ship_out, 0) end;
  v_total    := v_subtotal + v_shipping;
  v_code     := 'GDX-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.orders (order_code, seller_id, buyer_id, customer_name, phone, email, address, city, state, pincode,
                             is_goa, items, subtotal, shipping, total, utr, screenshot_path)
  values (v_code, v_seller, v_buyer, trim(p_customer->>'name'), v_phone, nullif(trim(p_customer->>'email'),''),
          trim(p_customer->>'address'), nullif(trim(p_customer->>'city'),''),
          nullif(trim(p_customer->>'state'),''), v_pincode, v_is_goa, v_lines,
          v_subtotal, v_shipping, v_total, nullif(trim(p_utr),''), p_screenshot_path);

  return query select v_code, v_total;
end $$;
grant execute on function public.place_order(jsonb, jsonb, text, text, uuid) to anon, authenticated;

-- ---------- 5. DELETE MY ACCOUNT ---------------------------------------
-- Keeps past orders for the seller's records, unlinked from the account.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if public.is_admin() or exists (select 1 from public.sellers where user_id = v_uid) then
    raise exception 'Admin and seller accounts cannot be deleted here';
  end if;
  update public.orders set buyer_id = null where buyer_id = v_uid;
  delete from auth.users where id = v_uid;   -- profile, addresses and cart go with it
end $$;
revoke execute on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> phase9-seller-logins.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =====================================================================
--  GDX — seller logins with default password + forced change
--  Run ONCE in Supabase → SQL Editor, after phase8-buyers.sql.
--  Safe to run again (existing logins and passwords are left alone).
-- =====================================================================

-- >>> Default password for NEW seller logins and for admin "Reset password".
--     Sellers must change it on first login. Change 'abcd' here if you like.
create or replace function public.default_seller_password()
returns text language sql immutable as $$ select 'abcd' $$;
revoke execute on function public.default_seller_password() from public, anon, authenticated;

-- ---------- 1. Seller table changes ------------------------------------
alter table public.sellers add column if not exists must_change_password boolean not null default false;
alter table public.sellers alter column whatsapp drop not null;    -- seller fills it on first login

-- Sellers can't change their login, active status or password flag themselves;
-- WhatsApp is checked whenever it is filled in.
create or replace function public.sellers_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and not public.is_admin() then
    if new.user_id is distinct from old.user_id or new.is_active is distinct from old.is_active
       or new.login_email is distinct from old.login_email then
      raise exception 'Only the master admin can change login or active status';
    end if;
    if new.must_change_password is distinct from old.must_change_password
       and coalesce(current_setting('mhc.password_flag', true), '') <> 'on' then
      raise exception 'Use Change password to update your password';
    end if;
  end if;
  new.whatsapp := nullif(regexp_replace(coalesce(new.whatsapp, ''), '\D', '', 'g'), '');
  if new.whatsapp is not null then
    if length(new.whatsapp) = 12 and new.whatsapp like '91%' then new.whatsapp := substr(new.whatsapp, 3); end if;
    if new.whatsapp !~ '^[6-9][0-9]{9}$' then raise exception 'Please enter a valid 10-digit WhatsApp number'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- A seller still on the default password can't see or change any shop data
create or replace function public.my_seller_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.sellers where user_id = auth.uid() and is_active and not must_change_password limit 1;
$$;

create or replace function public.admin_list_sellers()
returns setof public.sellers language sql stable security definer set search_path = public as $$
  select * from public.sellers where public.is_admin() order by created_at;
$$;

-- ---------- 2. Create a login (email + password) -----------------------
-- Internal helper: not callable from the website.
create or replace function public._ensure_login(p_email text, p_password text)
returns uuid language plpgsql security definer set search_path = public, extensions, auth as $$
declare v_email text := lower(trim(p_email)); v_uid uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid email: %', p_email; end if;
  select id into v_uid from auth.users where lower(email) = v_email limit 1;
  if v_uid is not null then return v_uid; end if;          -- already exists: keep its password

  v_uid := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
          '', '', '', '', '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_uid::text, v_uid,
          jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());
  return v_uid;
end $$;
revoke execute on function public._ensure_login(text, text) from public, anon, authenticated;

-- ---------- 3. Master: create/link a seller's login --------------------
create or replace function public.admin_create_seller_login(p_seller uuid, p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_new boolean;
begin
  if not public.is_admin() then raise exception 'Only the master admin can do this'; end if;
  v_new := not exists (select 1 from auth.users where lower(email) = lower(trim(p_email)));
  v_uid := public._ensure_login(p_email, public.default_seller_password());
  if exists (select 1 from public.sellers where user_id = v_uid and id <> p_seller) then
    raise exception 'That email is already linked to another seller';
  end if;
  perform set_config('mhc.password_flag', 'on', true);
  update public.sellers
     set user_id = v_uid, login_email = lower(trim(p_email)),
         must_change_password = case when v_new then true else must_change_password end
   where id = p_seller;
  return case when v_new then 'created' else 'linked' end;
end $$;
grant execute on function public.admin_create_seller_login(uuid, text) to authenticated;

-- ---------- 4. Master: reset a seller's password to the default --------
create or replace function public.admin_reset_seller_password(p_seller uuid)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception 'Only the master admin can do this'; end if;
  select user_id into v_uid from public.sellers where id = p_seller;
  if v_uid is null then raise exception 'This seller has no login yet'; end if;
  if v_uid = auth.uid() then raise exception 'Change your own password in My shop'; end if;
  update auth.users set encrypted_password = crypt(public.default_seller_password(), gen_salt('bf')),
                        updated_at = now() where id = v_uid;
  perform set_config('mhc.password_flag', 'on', true);
  update public.sellers set must_change_password = true where id = p_seller;
end $$;
grant execute on function public.admin_reset_seller_password(uuid) to authenticated;

-- ---------- 5. Anyone signed in with email: set a new password ----------
create or replace function public.set_my_password(p_new text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please log in again'; end if;
  if length(coalesce(p_new, '')) < 8 then raise exception 'Use at least 8 characters'; end if;
  if p_new = public.default_seller_password() then raise exception 'Choose a password different from the default'; end if;
  update auth.users set encrypted_password = crypt(p_new, gen_salt('bf')), updated_at = now() where id = v_uid;
  perform set_config('mhc.password_flag', 'on', true);
  update public.sellers set must_change_password = false where user_id = v_uid;
end $$;
revoke execute on function public.set_my_password(text) from anon;
grant execute on function public.set_my_password(text) to authenticated;

-- ---------- 6. Optional starter sellers -------------------------------------------
-- Creates each login (password = default above) and a seller shop for it.
-- Edit the list to add more later; existing ones are skipped.
do $$
declare e text; v_uid uuid;
begin
  -- Add seller login emails here if you want them created by SQL, e.g.
  --   'harish@example.com',
  -- (Easier: add sellers later from Admin → Sellers → + Add seller.)
  foreach e in array array[]::text[] loop
    v_uid := public._ensure_login(e, public.default_seller_password());
    if not exists (select 1 from public.sellers where user_id = v_uid) then
      insert into public.sellers (user_id, login_email, shop_name, whatsapp, must_change_password, outside_goa_shipping)
      values (v_uid, lower(e), initcap(replace(split_part(e, '@', 1), '.', ' ')), null, true, 100);
    end if;
  end loop;
end $$;

-- Check: the 5 sellers and whether they still need to change the default password
select shop_name, login_email, must_change_password as on_default_password
  from public.sellers order by created_at;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> phase10-auctions.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =====================================================================
--  GDX — Auctions  (gdxgarage.com/auction)
--  Run ONCE in Supabase → SQL Editor, after phase8-buyers.sql.
--  Safe to run again.
--
--  Rules enforced here (the website can't bypass them):
--   • Only signed-in (Google) users can start auctions or bid.
--   • Start: 1 photo, title, starting bid ≥ ₹1, min increment ≥ ₹1,
--     optional Buy-Now above the starting bid, end time 15 min – 30 days ahead.
--   • A bid is accepted only if the auction is live, the end time has not
--     passed (server clock), the bidder isn't the seller or already the
--     highest bidder, and the amount ≥ current bid + min increment
--     (or ≥ starting bid for the first bid). Everything else is rejected.
--   • Bids are processed one at a time per auction (row lock), so two
--     people bidding the same amount at the same moment can't both win.
--   • Anti-sniping: in the final 2 minutes each new bid must be at least
--     ₹100 higher (or the seller's increment if bigger), and every such bid
--     resets the clock to 2 minutes. Bidding ends after 2 quiet minutes.
--   • At the end time bidding closes automatically; the highest bidder wins.
--     Buy-Now ends the auction immediately.
--   • Bidders are shown by their Google name.
-- =====================================================================

-- ---------- 1. Tables ---------------------------------------------------
create table if not exists public.auctions (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references auth.users(id) on delete cascade,
  seller_name     text not null,
  seller_whatsapp text not null check (seller_whatsapp ~ '^[6-9][0-9]{9}$'),
  title           text not null check (length(title) between 3 and 80),
  description     text check (description is null or length(description) <= 600),
  photo_path      text not null,                 -- file in the 'auction-photos' bucket
  start_price     int  not null check (start_price between 1 and 1000000),
  min_increment   int  not null check (min_increment between 1 and 100000),
  buy_now_price   int  check (buy_now_price is null or buy_now_price > start_price),
  end_time        timestamptz not null,
  status          text not null default 'live' check (status in ('live','sold','cancelled','removed')),
  current_bid     int,
  current_bidder  uuid references auth.users(id) on delete set null,
  current_bidder_label text,
  bid_count       int  not null default 0,
  extensions      int  not null default 0,          -- times the end was pushed by late bids
  closed_at       timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.auctions add column if not exists extensions int not null default 0;
create index if not exists auctions_end_idx    on public.auctions (status, end_time);
create index if not exists auctions_seller_idx on public.auctions (seller_id, created_at desc);

create table if not exists public.auction_bids (
  id           bigint generated always as identity primary key,
  auction_id   uuid not null references public.auctions(id) on delete cascade,
  bidder_id    uuid references auth.users(id) on delete set null,
  bidder_label text not null,
  amount       int  not null,
  is_buy_now   boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists auction_bids_idx    on public.auction_bids (auction_id, amount desc);
create index if not exists auction_bids_me_idx on public.auction_bids (bidder_id, created_at desc);

-- ---------- 2. Who can read what ---------------------------------------
-- Auctions are public (except the seller's WhatsApp, shared only with the winner).
-- Nobody writes to the tables directly — only through the functions below.
alter table public.auctions     enable row level security;
alter table public.auction_bids enable row level security;
revoke all on public.auctions, public.auction_bids from anon, authenticated;

grant select (id, seller_id, seller_name, title, description, photo_path, start_price, min_increment,
              buy_now_price, end_time, status, current_bid, current_bidder, current_bidder_label,
              bid_count, extensions, closed_at, created_at)
  on public.auctions to anon, authenticated;
drop policy if exists "Anyone sees auctions" on public.auctions;
create policy "Anyone sees auctions" on public.auctions
  for select using (status <> 'removed' or public.is_admin());

-- Bids are read through auction_bids_for() (with bidder names); own bids readable for "My bids"
grant select (auction_id, amount, created_at) on public.auction_bids to authenticated;
drop policy if exists "Bidder sees own bids" on public.auction_bids;
create policy "Bidder sees own bids" on public.auction_bids
  for select to authenticated using (bidder_id = auth.uid());

-- ---------- 3. Helpers --------------------------------------------------
create or replace function public.server_now()
returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.server_now() to anon, authenticated;

-- "Maitreya Hinde" → "Maitreya H." ; falls back to the email name
create or replace function public._display_name(p_uid uuid)
returns text language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    nullif(trim(regexp_replace(
      split_part(trim(coalesce(p.full_name, '')), ' ', 1) || ' ' ||
      coalesce(left(nullif(split_part(trim(coalesce(p.full_name, '')), ' ', 2), ''), 1) || '.', ''),
      '\s+', ' ', 'g')), ''),
    split_part(u.email, '@', 1), 'Collector')
  from auth.users u left join public.profiles p on p.user_id = u.id
  where u.id = p_uid;
$$;
revoke execute on function public._display_name(uuid) from public, anon, authenticated;

-- Bidder name shown publicly: Google name, or the email name if Google gave none
create or replace function public._bidder_name(p_uid uuid)
returns text language sql stable security definer set search_path = public, auth as $$
  select coalesce(nullif(trim(regexp_replace(coalesce(p.full_name, u.raw_user_meta_data->>'full_name', ''), '\s+', ' ', 'g')), ''),
                  split_part(u.email, '@', 1), 'Collector')
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = p_uid;
$$;
revoke execute on function public._bidder_name(uuid) from public, anon, authenticated;

-- (old masking helper, no longer used)
create or replace function public._mask(p text)
returns text language sql immutable as $$
  select case when length(coalesce(p, '')) <= 2 then coalesce(left(p, 1), '?') || '•••'
              else left(p, 1) || '•••' || right(split_part(p, ' ', 1), 1) end;
$$;

-- ---------- 4. Start an auction -----------------------------------------
create or replace function public.create_auction(
  p_title text, p_description text, p_photo_path text,
  p_start_price int, p_min_increment int, p_buy_now_price int,
  p_end_time timestamptz, p_whatsapp text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_wa  text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Please sign in with Google to start an auction'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Please enter a title (at least 3 letters)'; end if;
  if length(trim(p_title)) > 80 then raise exception 'Title is too long (max 80 characters)'; end if;
  if length(coalesce(p_description, '')) > 600 then raise exception 'Description is too long (max 600 characters)'; end if;
  if coalesce(p_photo_path, '') = '' or split_part(p_photo_path, '/', 1) <> v_uid::text then
    raise exception 'Please add a photo of the car';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'auction-photos' and name = p_photo_path) then
    raise exception 'Photo upload did not finish — please add the photo again';
  end if;
  if p_start_price is null or p_start_price < 1 then raise exception 'Starting bid must be at least ₹1'; end if;
  if p_start_price > 1000000 then raise exception 'Starting bid is too high'; end if;
  if p_min_increment is null or p_min_increment < 1 then raise exception 'Minimum increment must be at least ₹1'; end if;
  if p_min_increment > 100000 then raise exception 'Minimum increment is too high'; end if;
  if p_buy_now_price is not null and p_buy_now_price < p_start_price + p_min_increment then
    raise exception 'Buy Now price must be at least ₹% (starting bid + increment)', p_start_price + p_min_increment;
  end if;
  if p_buy_now_price is not null and p_buy_now_price > 1000000 then raise exception 'Buy Now price is too high'; end if;
  if p_end_time is null or p_end_time < now() + interval '15 minutes' then
    raise exception 'End time must be at least 15 minutes from now';
  end if;
  if p_end_time > now() + interval '30 days' then raise exception 'End time can be at most 30 days from now'; end if;
  if length(v_wa) = 12 and v_wa like '91%' then v_wa := substr(v_wa, 3); end if;
  if v_wa !~ '^[6-9][0-9]{9}$' then raise exception 'Please enter a valid 10-digit WhatsApp number'; end if;
  if (select count(*) from public.auctions where seller_id = v_uid and status = 'live' and end_time > now()) >= 10 then
    raise exception 'You can have at most 10 live auctions at a time';
  end if;

  insert into public.auctions (seller_id, seller_name, seller_whatsapp, title, description, photo_path,
                               start_price, min_increment, buy_now_price, end_time)
  values (v_uid, public._display_name(v_uid), v_wa, trim(p_title), nullif(trim(coalesce(p_description, '')), ''),
          p_photo_path, p_start_price, p_min_increment, p_buy_now_price, date_trunc('minute', p_end_time))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_auction(text, text, text, int, int, int, timestamptz, text) from anon;
grant execute on function public.create_auction(text, text, text, int, int, int, timestamptz, text) to authenticated;

-- ---------- 5. Place a bid ---------------------------------------------
create or replace function public.place_bid(p_auction uuid, p_amount int)
returns table (out_current_bid int, out_bid_count int, out_next_min int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  a     public.auctions%rowtype;
  v_min int;
  v_inc int;
  v_late boolean;
  v_label text;
begin
  if v_uid is null then raise exception 'Please sign in with Google to bid'; end if;
  select * into a from public.auctions where id = p_auction for update;     -- one bid at a time
  if not found or a.status = 'removed' then raise exception 'Auction not found'; end if;
  if a.status = 'sold' then raise exception 'Sorry, this car was just bought with Buy Now'; end if;
  if a.status <> 'live' then raise exception 'This auction was cancelled'; end if;
  if now() >= a.end_time then raise exception 'Bidding has closed for this auction'; end if;
  if a.seller_id = v_uid then raise exception 'You can''t bid on your own auction'; end if;
  if a.current_bidder = v_uid then raise exception 'You are already the highest bidder'; end if;

  -- final 2 minutes: bigger steps (at least ₹100) and each bid resets the clock to 2 minutes
  v_late := a.end_time - now() <= interval '2 minutes';
  v_inc  := case when v_late then greatest(a.min_increment, 100) else a.min_increment end;
  v_min  := coalesce(a.current_bid + v_inc, a.start_price);
  if p_amount is null or p_amount < v_min then
    if v_late and a.current_bid is not null then
      raise exception 'Final 2 minutes: bids must be ₹% higher — the minimum bid now is ₹%', v_inc, v_min;
    end if;
    raise exception 'Bid too low — the minimum bid now is ₹%', v_min;
  end if;
  if a.buy_now_price is not null and p_amount >= a.buy_now_price then
    raise exception 'That''s at or above the Buy Now price — tap Buy Now for ₹% instead', a.buy_now_price;
  end if;
  if p_amount > v_min + greatest(v_inc * 100, 50000) then
    raise exception 'That bid is unusually high — please check the amount';
  end if;

  v_label := public._bidder_name(v_uid);
  insert into public.auction_bids (auction_id, bidder_id, bidder_label, amount)
  values (a.id, v_uid, v_label, p_amount);
  update public.auctions
     set current_bid = p_amount, current_bidder = v_uid, current_bidder_label = v_label, bid_count = bid_count + 1,
         end_time   = case when v_late then now() + interval '2 minutes' else end_time end,
         extensions = extensions + case when v_late then 1 else 0 end
   where id = a.id;
  return query select p_amount, a.bid_count + 1, p_amount + v_inc;
end $$;
revoke execute on function public.place_bid(uuid, int) from anon;
grant execute on function public.place_bid(uuid, int) to authenticated;

-- ---------- 6. Buy Now (ends the auction at once) -----------------------
create or replace function public.buy_now(p_auction uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); a public.auctions%rowtype; v_label text;
begin
  if v_uid is null then raise exception 'Please sign in with Google to buy'; end if;
  select * into a from public.auctions where id = p_auction for update;
  if not found or a.status = 'removed' then raise exception 'Auction not found'; end if;
  if a.status = 'sold' then raise exception 'Sorry, someone just bought this with Buy Now'; end if;
  if a.status <> 'live' then raise exception 'This auction was cancelled'; end if;
  if now() >= a.end_time then raise exception 'Bidding has closed for this auction'; end if;
  if a.buy_now_price is null then raise exception 'This auction has no Buy Now price'; end if;
  if a.seller_id = v_uid then raise exception 'You can''t buy your own car'; end if;

  v_label := public._bidder_name(v_uid);
  insert into public.auction_bids (auction_id, bidder_id, bidder_label, amount, is_buy_now)
  values (a.id, v_uid, v_label, a.buy_now_price, true);
  update public.auctions
     set status = 'sold', current_bid = a.buy_now_price, current_bidder = v_uid, current_bidder_label = v_label,
         bid_count = bid_count + 1, closed_at = now()
   where id = a.id;
end $$;
revoke execute on function public.buy_now(uuid) from anon;
grant execute on function public.buy_now(uuid) to authenticated;

-- ---------- 7. Cancel (seller, only before the first bid) / remove (admin) ---
create or replace function public.cancel_auction(p_auction uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.auctions%rowtype;
begin
  select * into a from public.auctions where id = p_auction for update;
  if not found then raise exception 'Auction not found'; end if;
  if public.is_admin() then
    update public.auctions set status = 'removed', closed_at = now() where id = a.id;
    return;
  end if;
  if a.seller_id is distinct from auth.uid() then raise exception 'Only the seller can cancel this auction'; end if;
  if a.status <> 'live' or now() >= a.end_time then raise exception 'This auction has already ended'; end if;
  if a.bid_count > 0 then raise exception 'Auctions with bids can''t be cancelled'; end if;
  update public.auctions set status = 'cancelled', closed_at = now() where id = a.id;
end $$;
revoke execute on function public.cancel_auction(uuid) from anon;
grant execute on function public.cancel_auction(uuid) to authenticated;

-- ---------- 8. Bid history (with bidder names) ---------------------------
create or replace function public.auction_bids_for(p_auction uuid)
returns table (amount int, bidder text, is_me boolean, is_buy_now boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.amount, b.bidder_label, b.bidder_id is not distinct from auth.uid() and auth.uid() is not null,
         b.is_buy_now, b.created_at
    from public.auction_bids b join public.auctions a on a.id = b.auction_id
   where b.auction_id = p_auction and (a.status <> 'removed' or public.is_admin())
   order by b.amount desc, b.created_at
   limit 100;
$$;
grant execute on function public.auction_bids_for(uuid) to anon, authenticated;

-- ---------- 9. Contact details — only seller & winner, only after it ends ---
create or replace function public.auction_contact(p_auction uuid)
returns table (seller_name text, seller_whatsapp text, seller_email text,
               winner_name text, winner_email text, winner_phone text, winning_bid int)
language plpgsql stable security definer set search_path = public, auth as $$
declare a public.auctions%rowtype;
begin
  select * into a from public.auctions where id = p_auction;
  if not found or auth.uid() is null then return; end if;
  if not (a.status = 'sold' or (a.status = 'live' and now() >= a.end_time)) or a.current_bidder is null then return; end if;
  if auth.uid() not in (a.seller_id, a.current_bidder) and not public.is_admin() then return; end if;
  return query
    select a.seller_name, a.seller_whatsapp, su.email::text,
           coalesce(nullif(wp.full_name, ''), split_part(wu.email, '@', 1)), wu.email::text, wp.phone, a.current_bid
      from auth.users su, auth.users wu left join public.profiles wp on wp.user_id = wu.id
     where su.id = a.seller_id and wu.id = a.current_bidder;
end $$;
revoke execute on function public.auction_contact(uuid) from anon;
grant execute on function public.auction_contact(uuid) to authenticated;

-- ---------- 10. Photo storage (1 photo per auction, public) --------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('auction-photos', 'auction-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Public reads auction photos" on storage.objects;
create policy "Public reads auction photos" on storage.objects
  for select using (bucket_id = 'auction-photos');
drop policy if exists "Users upload own auction photos" on storage.objects;
create policy "Users upload own auction photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'auction-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete own unused auction photos" on storage.objects;
create policy "Users delete own unused auction photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'auction-photos' and owner = auth.uid()
         and not exists (select 1 from public.auctions a where a.photo_path = storage.objects.name));

-- Show real names on bids placed before this update
update public.auction_bids set bidder_label = public._bidder_name(bidder_id) where bidder_id is not null;
update public.auctions set current_bidder_label = public._bidder_name(current_bidder) where current_bidder is not null;

-- Check
select 'Auctions installed' as result, (select count(*) from public.auctions) as auctions;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> phase11-gdx.sql >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- =====================================================================
--  GDX — Goa Diecast Exchange: community features
--  • Real shipping methods (Delhivery / India Post / Same-day pick & drop)
--  • Giveaways: spin wheel that picks a random signed-up member
--  • Sponsors / Patrons / Hot Wheels offline stores
--  • Home page live numbers
--  Run after phase10-auctions.sql. Safe to run again.
-- =====================================================================

-- ---------- 1. SHIPPING METHODS (master admin sets the rates) ----------
create table if not exists public.shipping_methods (
  code       text primary key check (code ~ '^[a-z0-9_]{2,30}$'),
  name       text not null,
  note       text,                                  -- e.g. "2–5 days · tracking"
  goa_rate   numeric(10,2) not null default 0 check (goa_rate >= 0),    -- pincode 403xxx
  india_rate numeric(10,2)          check (india_rate is null or india_rate >= 0),  -- null = not offered outside Goa
  is_active  boolean not null default true,
  sort       int not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.shipping_methods (code, name, note, goa_rate, india_rate, sort) values
  ('delhivery', 'Delhivery Courier',        '2–5 days · tracking number',         60, 120, 1),
  ('indiapost', 'India Post (Speed Post)',  '3–7 days · tracking number',         50,  90, 2),
  ('sameday',   'Same-day pick & drop',     'Within Goa only · delivered today',  150, null, 3)
on conflict (code) do nothing;

alter table public.shipping_methods enable row level security;
drop policy if exists "Anyone reads shipping methods" on public.shipping_methods;
create policy "Anyone reads shipping methods" on public.shipping_methods
  for select using (is_active or public.is_admin());
drop policy if exists "Admin manages shipping methods" on public.shipping_methods;
create policy "Admin manages shipping methods" on public.shipping_methods
  for all using (public.is_admin()) with check (public.is_admin());
grant select on public.shipping_methods to anon, authenticated;
grant insert, update, delete on public.shipping_methods to authenticated;

alter table public.orders add column if not exists ship_method      text;
alter table public.orders add column if not exists ship_method_name text;

-- ---------- 2. PLACE ORDER — shipping from the chosen method ----------
-- Replaces the older version (Goa free / seller's flat rate).
drop function if exists public.place_order(jsonb, jsonb, text, text, uuid);
drop function if exists public.place_order(jsonb, jsonb, text, text, uuid, text);
create or replace function public.place_order(
  p_customer        jsonb,
  p_items           jsonb,
  p_screenshot_path text,
  p_utr             text default null,
  p_seller_id       uuid default null,
  p_ship_method     text default 'delhivery'
)
returns table (out_code text, out_total numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_item     jsonb;
  v_prod     public.products%rowtype;
  v_qty      int;
  v_subtotal numeric := 0;
  v_lines    jsonb := '[]'::jsonb;
  v_pincode  text := trim(coalesce(p_customer->>'pincode',''));
  v_phone    text := regexp_replace(coalesce(p_customer->>'phone',''), '\D', '', 'g');
  v_seller   uuid := p_seller_id;
  v_method   public.shipping_methods%rowtype;
  v_is_goa   boolean;
  v_shipping numeric;
  v_total    numeric;
  v_code     text;
  v_buyer    uuid := auth.uid();
begin
  if v_buyer is null then raise exception 'Please sign in with Google to place your order'; end if;
  if exists (select 1 from public.sellers s where s.user_id = v_buyer) or public.is_admin() then
    raise exception 'Seller and admin accounts cannot place orders. Sign in with a buyer Google account.';
  end if;
  if length(v_phone) = 12 and v_phone like '91%' then v_phone := substr(v_phone, 3); end if;
  if coalesce(trim(p_customer->>'name'),'') = '' then raise exception 'Please enter your name'; end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Please enter a valid 10-digit mobile number'; end if;
  if coalesce(trim(p_customer->>'address'),'') = '' then raise exception 'Please enter your address'; end if;
  if v_pincode !~ '^[1-9][0-9]{5}$' then raise exception 'Please enter a valid 6-digit pincode'; end if;
  if coalesce(p_screenshot_path,'') = '' then raise exception 'Payment screenshot is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty'; end if;

  v_is_goa := v_pincode like '403%';
  select * into v_method from public.shipping_methods where code = coalesce(p_ship_method, 'delhivery') and is_active;
  if not found then raise exception 'Please choose a delivery option'; end if;
  if not v_is_goa and v_method.india_rate is null then
    raise exception '% is only available within Goa. Please choose another delivery option.', v_method.name;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then raise exception 'Invalid quantity in cart'; end if;

    select * into v_prod from public.products
      where id = (v_item->>'id')::uuid and is_active
      for update;
    if not found then raise exception 'A car in your cart is no longer available'; end if;
    if v_seller is null then v_seller := v_prod.seller_id; end if;
    if v_prod.seller_id is distinct from v_seller then
      raise exception 'Cars from different sellers must be paid separately';
    end if;
    if v_prod.stock < v_qty then
      raise exception 'Sorry, only % left of %', v_prod.stock, v_prod.name;
    end if;

    update public.products set stock = stock - v_qty, updated_at = now() where id = v_prod.id;
    v_subtotal := v_subtotal + v_prod.price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'id', v_prod.id, 'name', v_prod.name, 'price', v_prod.price,
      'qty', v_qty, 'image', v_prod.images[1]);
  end loop;

  if v_seller is not null and not exists (select 1 from public.sellers where id = v_seller and is_active) then
    raise exception 'This seller is not taking orders right now';
  end if;

  v_shipping := case when v_is_goa then v_method.goa_rate else v_method.india_rate end;
  v_total    := v_subtotal + coalesce(v_shipping, 0);
  v_code     := 'GDX-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.orders (order_code, seller_id, buyer_id, customer_name, phone, email, address, city, state, pincode,
                             is_goa, items, subtotal, shipping, total, utr, screenshot_path, ship_method, ship_method_name)
  values (v_code, v_seller, v_buyer, trim(p_customer->>'name'), v_phone, nullif(trim(p_customer->>'email'),''),
          trim(p_customer->>'address'), nullif(trim(p_customer->>'city'),''),
          nullif(trim(p_customer->>'state'),''), v_pincode, v_is_goa, v_lines,
          v_subtotal, coalesce(v_shipping, 0), v_total, nullif(trim(p_utr),''), p_screenshot_path,
          v_method.code, v_method.name);

  return query select v_code, v_total;
end $$;
grant execute on function public.place_order(jsonb, jsonb, text, text, uuid, text) to anon, authenticated;

-- ---------- 3. GIVEAWAYS ------------------------------------------------
create table if not exists public.giveaways (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  prize       text,
  winner_id   uuid references auth.users(id) on delete set null,
  winner_name text not null,
  entrants    int not null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
alter table public.giveaways enable row level security;   -- read through the functions below only
revoke all on public.giveaways from anon, authenticated;

-- Members who can win: everyone who signed in with Google
-- (seller and admin logins are left out)
create or replace function public._giveaway_pool(p_exclude_past boolean)
returns table (uid uuid, name text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, public._display_name(u.id)
    from auth.users u
   where not exists (select 1 from public.sellers s where s.user_id = u.id)
     and not exists (select 1 from public.admins a where a.user_id = u.id)
     and coalesce(u.raw_app_meta_data->>'provider', '') = 'google'
     and (not p_exclude_past or not exists (select 1 from public.giveaways g where g.winner_id = u.id));
$$;
revoke execute on function public._giveaway_pool(boolean) from public, anon, authenticated;

-- Names on the wheel ("Maitreya H." style) — public
create or replace function public.giveaway_entrants(p_exclude_past boolean default false)
returns table (name text)
language sql stable security definer set search_path = public as $$
  select name from public._giveaway_pool(p_exclude_past) order by random() limit 500;
$$;
grant execute on function public.giveaway_entrants(boolean) to anon, authenticated;

-- Spin: master admin only. The winner is picked here in the database, fairly, at random.
create or replace function public.draw_giveaway(p_title text, p_prize text default null, p_exclude_past boolean default true)
returns table (id uuid, winner_name text, entrants int)
language plpgsql security definer set search_path = public as $$
declare v_n int; v_pick record; v_id uuid;
begin
  if not public.is_admin() then raise exception 'Only the master admin can spin the wheel'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Give the giveaway a title'; end if;
  select count(*) into v_n from public._giveaway_pool(p_exclude_past);
  if v_n = 0 then
    if p_exclude_past and exists (select 1 from public._giveaway_pool(false)) then
      raise exception 'Everyone has already won once. Untick "Leave out members who already won" to include them.';
    end if;
    raise exception 'No members to pick from yet';
  end if;
  select * into v_pick from public._giveaway_pool(p_exclude_past) order by random() limit 1;
  insert into public.giveaways (title, prize, winner_id, winner_name, entrants, created_by)
  values (trim(p_title), nullif(trim(p_prize), ''), v_pick.uid, v_pick.name, v_n, auth.uid())
  returning giveaways.id into v_id;
  return query select v_id, v_pick.name, v_n;
end $$;
revoke execute on function public.draw_giveaway(text, text, boolean) from anon;
grant execute on function public.draw_giveaway(text, text, boolean) to authenticated;

-- Past winners — public
create or replace function public.giveaway_winners(p_limit int default 30)
returns table (id uuid, title text, prize text, winner_name text, entrants int, created_at timestamptz, is_me boolean)
language sql stable security definer set search_path = public as $$
  select g.id, g.title, g.prize, g.winner_name, g.entrants, g.created_at, (g.winner_id = auth.uid())
    from public.giveaways g order by g.created_at desc limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.giveaway_winners(int) to anon, authenticated;

-- Remove a test draw — master admin only
create or replace function public.delete_giveaway(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the master admin can do this'; end if;
  delete from public.giveaways where id = p_id;
end $$;
revoke execute on function public.delete_giveaway(uuid) from anon;
grant execute on function public.delete_giveaway(uuid) to authenticated;

-- Winner sees their WhatsApp-ready contact on their own record (nothing public)
-- ---------- 4. SPONSORS / PATRONS / OFFLINE STORES ----------------------
create table if not exists public.sponsors (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'sponsor' check (kind in ('sponsor', 'patron', 'store')),
  name       text not null,
  logo_url   text,
  about      text,
  address    text,
  phone      text,
  website    text,
  map_url    text,
  sort       int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.sponsors enable row level security;
drop policy if exists "Anyone reads active sponsors" on public.sponsors;
create policy "Anyone reads active sponsors" on public.sponsors
  for select using (is_active or public.is_admin());
drop policy if exists "Admin manages sponsors" on public.sponsors;
create policy "Admin manages sponsors" on public.sponsors
  for all using (public.is_admin()) with check (public.is_admin());
grant select on public.sponsors to anon, authenticated;
grant insert, update, delete on public.sponsors to authenticated;

-- ---------- 5. HOME PAGE NUMBERS ----------------------------------------
create or replace function public.home_stats()
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'cars',     (select count(*) from public.products where is_active and stock > 0),
    'sellers',  (select count(*) from public.sellers where is_active),
    'auctions', (select count(*) from public.auctions where status = 'live' and end_time > now()),
    'members',  (select count(*) from public._giveaway_pool(false)),
    'giveaways',(select count(*) from public.giveaways),
    'next_auction_end', (select min(end_time) from public.auctions where status = 'live' and end_time > now())
  );
$$;
grant execute on function public.home_stats() to anon, authenticated;

select 'GDX community update installed' as result;
