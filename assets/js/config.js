/* ==========================================================================
   Cadence by Corvexsa — site configuration

   Every value is a plain string; an EMPTY string means "not open yet" and the
   pages render an honest state for it (never a fake or broken link, never an
   invented number).

   Payments are NOT open. The paid plans (Pro, Studio, Founders) are written
   in the HTML as "Opening soon" buttons that link nowhere, and no page links
   to a checkout. The old one-time $9 / $12 Payment Links were removed from
   the site on 2026-09-27; wiring the new plans' links is a separate, later
   step (CadenceAI/design/research/money.md §13 step 3) that needs Aly's
   "go live" first.

   Loaded before site.js on every page.
   ========================================================================== */

window.CADENCE_CONFIG = {
  /* Base URL of Cadence's licence service, with no trailing slash. The pages call:
       GET {LICENSE_API}/stats                    -> { founders?: { sold, limit, left } }   (pricing.html)
       GET {LICENSE_API}/verify?email=...&key=... -> { valid, tier, plan?, paid_until?, since, ... }  (account.html)
       GET {LICENSE_API}/license?session_id=...   -> { key, email, tier?, plan?, seatKeys?, ... }   (thanks.html)
     Both the v1 answers (old keys: { valid, tier: 'pro', since } / { key, email })
     and the v2 answers (tier founder / pro / studio) are understood. The service
     must list this site's origin in its ALLOWED_ORIGINS, or the browser blocks
     the answer. Empty: account.html and thanks.html say checks aren't connected. */
  LICENSE_API: 'https://cadence-license.onrender.com',

  /* The support address shown on every contact line. It must be a Corvexsa
     address, never a personal one. Empty: the pages show "[SUPPORT EMAIL]". */
  SUPPORT_EMAIL: ''
};
