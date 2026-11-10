// =====================================================================
//  GDX — Goa Diecast Exchange — site configuration
//  These keys are public by design and safe to commit to GitHub.
//  NEVER paste the service_role / sb_secret_ key here.
// =====================================================================
window.MHC_CONFIG = {
  // GDX Supabase project (rdljysqubvdqxdlqljsz)
  SUPABASE_URL:      'https://rdljysqubvdqxdlqljsz.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_gbrWWaaWaJkp0r3gSD748A_HEGj5hpj',

  STORE_NAME:  'GDX',
  STORE_FULL:  'Goa Diecast Exchange',
  STORE_TAGLINE: 'The biggest diecast community platform in Goa',

  // Shown in the footer and on the Contact page
  STORE_LOCATION: 'Goa',
  CONTACT_PHONE:  '7358425108',
  // Footer contacts (name + 10-digit WhatsApp)
  CONTACTS: [
    { name: 'Harish',   phone: '7720876801', facebook: 'https://www.facebook.com/profile.php?id=100007156157694' },
    { name: 'Maitreya', phone: '7358425108', facebook: 'https://www.facebook.com/MaitreyaHinde/' }
  ],
  WHATSAPP_GROUP: 'https://chat.whatsapp.com/BfcQaxJJqoqALCqhTFt1DB',
  FACEBOOK_PAGE:  '',
  FOUNDER_NAME:   'Maitreya Hinde',
  FOUNDER_URL:    'https://www.facebook.com/MaitreyaHinde/',
  DESIGNER_NAME:  'MHC Digital',
  DESIGNER_URL:   'https://www.facebook.com/MHCdigital/',
  // (Sellers sign in with Google — no seller passwords.)

  CURRENCY:   '₹',
  GOA_PINCODE_PREFIX: '403'      // Goa pincodes (Goa rates + same-day option)
};
