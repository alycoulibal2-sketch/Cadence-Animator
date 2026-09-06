/* ==========================================================================
   Cadence Animator — site configuration

   The only file the owner edits to switch Pro on. Every value is a plain
   string; an EMPTY string means "not open yet" and the pages render an honest
   disabled state for it (never a fake or broken link, never an invented
   number). Fill a value in, redeploy, done.

   Loaded before site.js on every page.
   ========================================================================== */

window.CADENCE_CONFIG = {
  /* Stripe Checkout / Payment Link for the Founding price (first 100 keys). */
  PRO_FOUNDING_LINK: '',

  /* Stripe Checkout / Payment Link for the regular price. */
  PRO_LINK: '',

  /* Base URL of the licence API, with no trailing slash, e.g.
     'https://licence.example.com'. The pages call:
       GET {LICENSE_API}/stats                         -> { founding: { sold, limit } }
       GET {LICENSE_API}/verify?email=...&key=...      -> { valid, tier, since }
       GET {LICENSE_API}/license?session_id=...        -> { key, email }
     Empty: pricing hides the founding counter, account.html and thanks.html
     explain that verification opens with Pro. */
  LICENSE_API: '',

  /* Where a buyer writes when a key does not arrive. Empty: pages point at
     the GitHub issue tracker instead. */
  SUPPORT_EMAIL: ''
};
