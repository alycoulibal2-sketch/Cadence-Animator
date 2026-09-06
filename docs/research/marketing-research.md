# Marketing psychology, monetisation and channel research for Cadence (2026-09-06)

A research pass (15 web searches plus direct fetches) run for the site rebuild and the pricing
decision. Source marks: **[S]** fetched that day (URL given) · **[M]** canonical reference cited from
memory, not re-fetched · **[I]** inference. Reddit, nngroup.com, ftc.gov and web.archive.org were
unreachable from the machine, so those items are [M].

## What the site said that day [S]

https://alycoulibal2-sketch.github.io/Cadence-Animator/: hero "Animate Roblox rigs in a real desktop
app", CTAs "Download for Windows"/"Read the docs", a numbers strip (52 easings, 63 shortcuts, 135 MCP
tools, 396 presets), then Animator → Studio → Beyond joints → VFX → Procedural → MCP → Moon comparison
table → Download (97.4 MB installer + portable + npm, SHA-256s, "More info → Run anyway" note) → FAQ.
Strong trust copy ("no telemetry, account, or licence key"; 51-check smoke test; MIT). Missing: any
video/GIF, any social proof, any pricing/support ask, a live star/download count, a roadmap/changelog
link, and a "why free / who made this" story.

## 1. Psychology principles that apply

| Principle | Best evidence (and how strong) | Apply to Cadence |
|---|---|---|
| Social proof | Cialdini, *Influence*; hotel-towel field study, Goldstein/Cialdini/Griskevicius 2008 doi:10.1086/586910 [M]. Works when the proof is *similar people*. | With no user base: honest live counts (GitHub stars badge, release-download count from the GitHub API), named real projects, and the maker's age. "Built by a 13-year-old Roblox animator" is *similarity + authenticity* for an 11–20 audience [I]; it only works if paired with competence signals (tests, checksums, commit history). Never pad numbers: the FTC rule below covers "fake indicators of social influence" [S]. |
| Authority/credibility | Fogg et al. 2003, Stanford web-credibility study: visual design quality dominated credibility judgements doi:10.1145/997078.997097 [M]. | The page already has the right artefacts (SHA-256, MIT, source, smoke test). Add: signed releases when affordable, a public roadmap, a changelog, an issue tracker link near the download. |
| Reciprocity | Regan 1971 doi:10.1016/0022-1031(71)90025-4 [M]. | The free core is the gift; ask *after* value is felt (after first export), not on the landing page. |
| Honest scarcity | Worchel/Lee/Adewole 1975 doi:10.1037/h0076935 [M]. Fake timers are illegal-adjacent (FTC dark-patterns enforcement) [M]. | Only true scarcity: a numbered "Founding" cohort (first 100) and a pre-announced price rise. |
| Anchoring | Tversky & Kahneman 1974 doi:10.1126/science.185.4157.1124 [M]. | The anchor is Moon Animator 2: list **$29.99 USD**, currently **$19.99** "33% off" (Creator Store toolbox API, Aug 2026) [S] https://apis.roblox.com/toolbox-service/v1/items/details?assetIds=4725618216. Show that number next to Cadence's price. |
| Decoy pricing | Huber/Payne/Puto 1982 [M]; a 2021 pre-registered replication of Ariely's Economist demo failed in Study 1 and found a much smaller effect in Study 2 [S] https://www.tandfonline.com/doi/full/10.1080/23743603.2021.1878340. | **Don't build a decoy tier.** Overclaimed. Two options max. |
| Pay-what-you-want | Gneezy et al. 2010 *Science*: PWYW raised take-up ~16× but average paid ≈$0.92; PWYW + "half to charity" gave ~4.5% take-up at $5.33 and the highest profit [S summary] https://www.nationalgeographic.com/science/article/caring-with-cash-or-how-radiohead-could-have-made-more-money. Gneezy et al. 2012 PNAS: PWYW can *lower* demand (self-signalling) [S] https://marketing.wharton.upenn.edu/wp-content/uploads/2020/07/Pay-What-You-Want-PAPER-Gneezy-Ayelet-4-12-2012.pdf. itch.io: "30% of all money spent on itch.io is extra money above the minimum; the average purchase is about $1.50 more than the minimum" [S] https://itch.io/docs/creators/pricing. Hive Time case: far more downloads, fewer payments; an in-app prompt explaining PWYW raised sales [S] https://itch.io/t/1081038/money-for-the-honey-a-case-study-of-pay-what-you-want-pricing-on-itchio. Humble Bundle needed a $1 floor [S] https://en.wikipedia.org/wiki/Humble_Bundle. | PWYW removes the "can't afford it" refusal while letting parents pay more. It needs a **suggested price (preset)** and a **floor**; Stripe Checkout supports preset/min/max natively [S] https://docs.stripe.com/payments/checkout/pay-what-you-want. Attach a visible purpose. |
| Charm/price endings | Anderson & Simester 2003: $39 outsold $34 and $44 in a catalogue; strongest for unfamiliar items [S title/year] https://api.openalex.org/works/https://doi.org/10.1023/A:1023581927405. ProfitWell claims .99 endings barely move SaaS willingness-to-pay [M]. | Weak-to-moderate evidence. Round numbers read as "gift", charm prices as "retail" [I]. |
| Loss aversion & framing | Kahneman & Tversky 1979; Tversky & Kahneman 1981 [M]. | "Never lose an animation again — 10 rolling backups" beats "auto-save". Frame the Moon comparison as what you *don't* give up. |
| Endowment effect | Kahneman/Knetsch/Thaler 1990 [M]. | Make the first run produce a *saved, exported* clip in under five minutes. |
| Commitment/consistency | Freedman & Fraser 1966 [M]. | Ladder of tiny asks: download → star → Discord → report a bug → support. |
| Goal gradient | Kivetz/Urminsky/Zheng 2006; Nunes & Drèze 2006 (pre-stamped cards: 34% vs 19% completion) [M]. | First-run checklist with the first two items pre-ticked. |
| Processing fluency | Reber/Schwarz/Winkielman 2004; NN/G: 57% of viewing time is above the fold [M] https://www.nngroup.com/articles/scrolling-and-attention/. | One promise, one picture, one button above the fold; move the big numbers down. |
| Peak-end rule | Kahneman et al. 1993 [M]. | End onboarding on the export playing in Studio; the support ask sits right after. |
| Benefits vs features | Levin & Gaeth 1988 [M]. | Section heads as outcomes: "Fix a foot slide in one drag (IK)". |
| Paradox of choice | Iyengar & Lepper 2000 [M]; the 2010 meta-analysis of 50 experiments found a **mean effect near zero** [S] https://api.openalex.org/works/https://doi.org/10.1086/651235. | Two prices and one free path. |
| Freemium benchmarks | Lenny/OpenView/Pendo: freemium self-serve "good" 3–5%, "great" 6–8%; developer products' median ≈5% [S] https://www.lennysnewsletter.com/p/what-is-a-good-free-to-paid-conversion. | Expect ≤2% of a card-less teen audience to pay [I]. Model revenue on parents, adult hobbyists and studios. |

Cialdini's own ethics test [M]: use a principle only when it is *true*.

## 2. Monetisation that worked for open/free creator tools

- **Moon Animator 2** [S]: free Feb 2020; paid by Feb 2023 at 1.2k→1.7k Robux; since Roblox moved plugins to USD (April 2024, min **$4.99**, Roblox keeps ~10%; sellers need Stripe ID-verified onboarding, 18+ or 13–17 via a guardian) [S] https://devforum.roblox.com/t/creator-store-buy-and-sell-plug-ins-with-real-world-currency/2923445 — Moon lists at $29.99, now $19.99 on sale, 18.6k up / 1.4k down votes (93%) [S]. "Is Moon Animator worth it?": valued = easing curves, multi-rig, mirror, axes; objections = price, "Blender is free", redesign confusion [S] https://devforum.roblox.com/t/is-moon-animator-worth-it/2477738. A YouTube title "Why is Moon Animator 30$ Now…" exists [S] https://www.youtube.com/watch?v=6uOE4AgUjWw.
- **Aseprite**: source-available since 2016; compile it yourself free or pay $19.99 for binaries + updates [S] https://www.aseprite.org/faq/; Steam 12,138 reviews, 99% positive [S] https://store.steampowered.com/app/431730/Aseprite/. **People pay for the built, updated binary even when the code is public.**
- **Krita**: free on krita.org; Steam copy sold for "supporting development + auto-updates" (3,675 reviews, 96%) [S] https://store.steampowered.com/app/280680/Krita/; Steam ~€500/month in 2016, the dev fund ~€350/month [S] https://krita.org/en/posts/2016/funding-kritas-development/.
- **Obsidian**: free without limits; Sync $4/mo, Publish $8/mo, **Catalyst $25 one-time** (early access, badges), Commercial $50/yr optional [S] https://obsidian.md/pricing. **The closest template.**
- **Sublime Text**: $99, nag [S] https://sublimehq.com/store/text. Wrong for teens.
- **Blender**: open-sourced by a €100,000 crowdfund in 2002 [S] https://en.wikipedia.org/wiki/Blender_(software).
- **Sponsorware** (Caleb Porzio) [S] https://raw.githubusercontent.com/sponsorware/docs/master/README.md.

**What an MIT app can sell**: the built, signed, auto-updating installer; early access to new modules; a supporter identity (badge, name in About); priority Discord channel; a commercial/studio licence. Not: features removed from the public code (a fork can restore them — say so).

## 3. Landing-page evidence for dev tools

- Above the fold: value + primary CTA; 57% of attention is above the fold [M NN/G]. A 90-second demo converted better than a 4-minute one in a SproutVideo case (2.1%→8.3%) [S, secondary] https://swarmify.com/blog/video-landing-page/.
- **Download friction is the real wall**: unsigned → "Windows protected your PC"; signed OV/EV still shows "unrecognized" until reputation builds; **EV no longer bypasses SmartScreen**; Smart App Control on Win11 blocks unsigned outright [S] https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation. Artifact Signing is $9.99/month but **individuals only in US/Canada**; else OV cert $150–300/yr [S] https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options. Microsoft's own advice: sign every release with one identity and *tell early adopters to expect the prompt* [S].
- Trust elements the best indie sites share (Obsidian, Aseprite, Linear/Raycast/Warp [M]): one-line promise, product footage, changelog/roadmap links, open-source badge, explicit privacy line, a comparison page vs the incumbent, FAQ in the user's words.

## 4. Zero-budget demand-pull channels

- **Roblox DevForum → Community Resources** [S] https://devforum.roblox.com/t/about-the-community-resources-category/120546: allowed = "Free or paid plugins you wish to showcase", significant, self-made, "well explained; do not dump content". Forum rules: no soliciting others to advertise [S] https://devforum.roblox.com/t/roblox-developer-forum-rules-international-communities/3170997. Format: `[Open source] Cadence Animator — Moon Animator 2 keybinds, IK, onion skin, VFX, two-way Studio sync` + 20 s GIF + what/why/limitations + download/source + "reply with bugs".
- **Reddit**: contribute ≫ promote; link-only posts get removed [M]. Post as an image/GIF with the link in a comment [I].
- **YouTube**: demand around "smooth animations", "beginner to pro", "Moon Animator basics" and the price complaint [S] https://www.youtube.com/playlist?list=PLNGoNEmBjtiuK-I_yHDMprcD6OBBfHWeG.
- **Shorts/TikTok**: 15-second before/after clips of one visible fix [I].
- **Creator Store listing for CadenceBridge**: free assets need no seller onboarding [S].
- **Discord**: answer questions in animator servers; never drop links in Moon's own server [I].
- **Show HN** fits once at 1.0 (MIT + MCP angle) [S] https://news.ycombinator.com/showhn.html.

## 5. Legal/ethical guardrails

- **Stripe**: minimum age 13; under 18 "a legal guardian must assume the role of owner of your account before your account can accept charges" [S] https://support.stripe.com/questions/age-requirement-to-create-a-stripe-account. → sell through the household company's existing live account (Trainis FZE-LLC).
- **PWYW mechanics**: "Customer chooses price" with preset/min/max; one-time only [S] https://docs.stripe.com/payment-links/create.
- **Tax**: digital goods are taxed in the customer's country; EU via OSS [S] https://docs.stripe.com/tax/how-tax-works. Stripe **Managed Payments** acts as merchant of record and handles VAT in 80+ countries [S] https://docs.stripe.com/payments/managed-payments/tax-compliance — the sane route for a one-person shop.
- **Refunds**: EU 14-day withdrawal can be waived for digital content once download starts with consent (Directive 2011/83/EU art. 16(m)) [M]. Offer 14 days, no questions [I].
- **GDPR-minimal**: keep "no account needed to use the app"; a licence/receipt e-mail only; publish a 10-line privacy page.
- **FTC Consumer Reviews rule (16 CFR 465)**: bans fake/false reviews, bought reviews, undisclosed insider reviews, fake social-media indicators [S] https://www.law.cornell.edu/cfr/text/16/part-465. So: no seeded reviews, no fake counters or countdowns, no sock-puppet replies.

## Apply it to Cadence — the checklist

**Landing page order**: hero (one promise, one button, one trust line) → 20–40 s loop → "Moon costs $29.99; Cadence's core is free" comparison → honest proof strip (live stars + downloads, real projects, "built in public by a 13-year-old") → three outcome sections → download block with the SmartScreen screenshot and "why you see this" → pricing card → FAQ ("Is it safe?", "Why is it free?", "I don't have a card") → roadmap + changelog.

**Copy angles**: not a cut-down version; your keybinds work on day one; never lose an animation; nothing leaves your PC; built by one of you, in public.

**Pricing (Stripe Checkout, one-time)**: the free core forever; one paid tier with a real, numbered founding price for the first 100; round numbers; state the purpose (code signing so the warning goes away).

**First five channels**: DevForum Community Resources; YouTube (60-s switch video + 10-min first-animation tutorial); Shorts/TikTok (15-s single-fix clips); Creator Store listing for the bridge plugin; r/robloxgamedev after reading its rules.
