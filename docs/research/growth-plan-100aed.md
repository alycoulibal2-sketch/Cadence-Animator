# Cadence Animator — 90-day zero-budget popularity plan (2026-09-06)

Research pass (11 web searches plus direct fetches and the GitHub API). Baseline measured that day.

**Baseline, measured via the GitHub API:** repo created 2026-07-15, **0 stars, 0 forks**, 34 releases in
17 days, **237 total asset downloads** (v0.10.0: 7 installer + 4 portable; `latest.yml` hits = update
checks from installed copies). The site had SHA-256s and a SmartScreen sentence but no creator line, no
Discord/DevForum/YouTube links, one screenshot, no GIF. The app has **no clip recorder** (no
`MediaRecorder`; only `--screenshot`), but `.cfx` save/open and PNX group export/import exist. GitHub
Discussions is off.

## 1. What 100 AED (≈US$27) buys

| Item | Price | Verdict |
|---|---|---|
| Domain, Porkbun: .com **$11.08/yr**; .dev $8.75 then $12.87; .app $8.75 then $14.93; .xyz $2.04 then $14.21; .io $28.12 then $51.80 (https://porkbun.com/products/domains) | ≈AED 41 (.com) | The only purchase that compounds (one stable link on every post; free on GitHub Pages). Needs a card → an adult must pay. |
| Code signing, Microsoft Artifact Signing: "Starts at $9.99/month"; paid Azure subscription required; **individuals must be in the US or Canada**; org list excludes the UAE (https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation, https://learn.microsoft.com/en-us/azure/artifact-signing/faq) | ≈AED 440/yr and ineligible | Impossible. Commercial OV certs cost hundreds of dollars a year (inference). Microsoft: "EV certificates no longer bypass SmartScreen." |
| **SignPath Foundation free OSS signing** (https://signpath.org/, conditions https://signpath.org/terms): OSI licence, maintained, released, documented; MFA on GitHub; a "Code signing policy" section on the site; binaries built from the repo via CI; publisher shows as "SignPath Foundation" | Free | **Apply in week 1.** No age rule published; a parent should be aware of the application (inference). |
| Microsoft Store: Store apps "are never subject to SmartScreen download warnings" (Microsoft, above) | Partner Center fee ≈US$19 one-time (from memory, unverified); account needs an adult (inference) | Best long-term fix if a parent registers once. |
| Discord server | Free | Yes, with a parent as co-owner. |
| Roblox ads | Robux/adult | No. |
| Robux giveaway (AED 20 digital cards exist) | AED 20 | No: invites DMs from strangers, buys followers not users. |
| Canva Pro "US$180/year" (https://www.canva.com/pricing/) | Over half the budget | Free tier suffices. |
| Microphone | ≈AED 100+ (inference) | Phone mic + Audacity, or no voice. |

**Pick: the .com domain (≈AED 41) if an adult can pay; otherwise spend nothing.** Everything that
moves downloads is free: SignPath, GitHub Actions, OBS, Discord, the forum.

## 2. Launch sequence, channel by channel

**Roblox DevForum → Community Resources (week 2).** Rules: "significant resources that you created
yourself"; "Free or paid plugins you wish to showcase"; "Websites that are useful to Roblox
development"; must be "Well explained" and "Significant overall"
(https://devforum.roblox.com/t/about-the-community-resources-category/120546). Posting access is granted
automatically after reading time. Anti-spam: "Do not bump old topics or post duplicate topics"; reply to
your own thread only "if you have significant new information"; "Do not solicit other developers ... to
advertise" (https://devforum.roblox.com/t/roblox-developer-forum-rules-international-communities/3170997).
Format evidence: Moon Animator's DevForum presence is an *unofficial tutorial* thread with **237,387
views, 589 likes** (https://devforum.roblox.com/t/getting-started-with-moon-animator-2-unofficial/476330);
SteakParticles (paid) opens with three pain questions and four screenshots and got 11 likes
(https://devforum.roblox.com/t/steakparticles-plugin-for-creating-vfx-and-particle-emitters/2908779); the
free "Moon Animator 2 to In Game Animations" module got 89 likes because Moon's export cannot animate
multiple objects in-game (https://devforum.roblox.com/t/module-script-moon-animator-2-to-in-game-animations/3178584).
Bridge precedent: Rojo's Studio plugin connects to a local executable on localhost port 34872
(https://rojo.space/docs/v7/getting-started/new-game/). Post shape: title `[Free, open source] Cadence
Animator — desktop animator + VFX studio for Roblox (Moon keybinds, IK, onion skin, live Studio sync)`;
hero GIF ≤15 s; three lines of who/pain; five GIFs; download with SHA-256 and an honest SmartScreen
paragraph; "how it talks to Studio" (localhost bridge, plugin source, the permission prompt users will
see); limitations; roadmap. One reply per release with a GIF changelog. Never "bump". A second thread
later in Community Tutorials (tutorials carry the long tail).

**r/robloxgamedev (119,460 subscribers; Arctic Shift).** What scored since mid-2025: "I made a free
tool that turns Roblox models into rendered UI icons" **133 upvotes/28 comments** (image); "I made a tool
that turns text into Roblox animations" **119/115** (video); "Plugin to make VFX/Textures in Roblox" 33
(video); "Moon animator animation coming out wrong in-game" 32/25; "Moon animator is blatantly a bad
animation software..." 29/13; "Is there an open source way to play VFX animations you've made with moon
animator?" 10. All use flair "Creation". Inference: flair Creation, title "I made a free ...", video/GIF
as the post body, GitHub link in a comment, one post per release, answer every comment.

**YouTube.** Channels and numbers (scraped 2026-09-06): TnxBlox 1.54M subs, "SUPER SMOOTH Roblox
Animations with Moon Animator 2" 67,395 views; MonkeyDev 33K, "How to make SMOOTH animations in ROBLOX
STUDIO! [Moon Animator Tutorial]" **486,549** views, 5:03 (https://www.youtube.com/watch?v=-Bxc4gJluC0);
Mr. Squiggly 22.9K, "Moon Animator Basics" **329,135**, 1:46; TrendyV2 17.6K, "ROBLOX VFX Guide #1 -
Particles" **331,368**, 7:14 (https://www.youtube.com/watch?v=xzZeP65SSlA); six (Moon's author) 14.9K,
official tutorial 1,834,590; ghxstying 13.2K, "Particles/VFX Tutorial: The Basics + Plugins" 84,898;
Mattronix, 1.14K subs, "Moon Animator 2 For COMPLETE NOOBS!" 11,394 views in a year — proof a tiny
channel gets search traffic with a search-shaped title. Pattern: 2–7 minutes, one shouted word,
search-driven. Cadence titles: "Moon Animator vs Cadence (free): same keybinds, 3 things Moon can't do",
"Make this Roblox VFX in 40 seconds (no nodes, no Blender)". Thumbnail: the effect at full size, three
words, no face.

**TikTok/Shorts (inference).** Frame 1 = finished effect, overlay "free · no Blender · no scripts";
15–30 s; end on the loop; link in bio.

**Discord.** Roblox Developers, 38,157 members, has self-promotion and creation-showcase channels
(https://discord.com/servers/roblox-developers-723489276821766205); HiddenDevs ≈295,000 members
(https://discord.com/invite/hd); Rojo and Tooling Discord for tooling people. Post only in the designated
channel, once per release, never DM anyone.

**GitHub.** Add a GIF at the top of the README, a "Code signing policy" section, enable Discussions, and
PR a line into `elevenpassin/awesome-roblox` and `awesome-roblox/awesome-roblox`. Show HN is suitable in
week 8 with the MCP/deterministic-VFX angle (https://news.ycombinator.com/showhn.html). Product Hunt: skip.

**Honesty rules:** one account per platform, the maker's own; never seed comments, never ask friends to
upvote.

## 3. The free content engine

Record once a week with OBS (WGC capture) or Win+Alt+R; build item for week 1: an in-app **Record 15 s
clip** (`canvas.captureStream` + `MediaRecorder` → .webm) with an optional corner mark. One Saturday
recording → four cuts: 16:9 60–90 s (YouTube), 9:16 20–30 s (Shorts/TikTok), ≤15 s GIF ≤8 MB
(DevForum/Reddit/README), one still (thumbnail).

Templates: **A Before/After**; **B One value** (one Sheet value changes, the whole effect changes,
three variants in 20 s); **C Claude animates**; **D Pain → fix** (a real pain quote as the title card,
the fix, the in-game proof).

## 4. Loops that make users bring users

1. **"Made with Cadence" corner mark** in the clip recorder and exported videos, on by default, one
   click off.
2. **.cfx sharing**: a pinned "Share your effect" reply in the DevForum thread and a `#effects` Discord
   channel; each shared `.cfx` re-posted as a 10 s GIF with credit.
3. **Recipes in the app** ship community `.cfx` files with the author's handle.
4. **Tutorial request form** = GitHub Discussions category "Tutorial requests"; each answered request
   becomes next week's clip.
5. **User tutorials**: Moon's growth came from an unofficial 237k-view tutorial thread and third-party
   YouTube tutorials; Rojo grew through the DevForum and its Discord; Aseprite (39,254 stars) and Krita
   (10,320 stars) run on community forums. Reward the first three people who make a Cadence tutorial with
   a pinned link on the site.

## 5. Measurement with no budget

- Downloads: `GET https://api.github.com/repos/alycoulibal2-sketch/Cadence-Animator/releases` →
  `assets[].download_count`; `latest.yml` count ≈ active installs. Stars/forks: `/repos/...`. Traffic
  (owner only, 14-day window): `/traffic/views`, `/traffic/clones` — snapshot weekly with a scheduled
  GitHub Action into `metrics.json`.
- DevForum: `https://devforum.roblox.com/t/<id>.json` → `views`, `like_count`.
- YouTube Studio: CTR, average view duration, traffic source.
- Site: GoatCounter (free for non-commercial, cookieless; https://github.com/arp242/goatcounter) or
  Umami Cloud Hobby (100k events/month, free); count download-button clicks vs release downloads to
  measure the SmartScreen / "is it a virus" drop.
- Targets (inference): **Day 30** ≥150 launch-version installer downloads, ≥25 stars, DevForum ≥1,500
  views/≥30 likes, one user-made effect. **Day 60** ≥500 downloads, ≥60 stars, first outside tutorial,
  ≥10 shared `.cfx`. **Day 90** ≥1,500 cumulative downloads, ≥100 stars, weekly `latest.yml` hits
  rising, ≥3 unsolicited mentions. If the DevForum thread is under 300 views after a week, the
  title/GIF is wrong, not the product.

## 6. Risks

**SmartScreen.** Users see "Windows protected your PC — Microsoft Defender SmartScreen prevented an
unrecognized app from starting. Running this app might put your PC at risk." with "More info" hidden
under a link, then "Run anyway". Microsoft: unsigned files start "with zero reputation" for **every new
version**; reputation "can take several weeks and hundreds of clean installs"; Windows 11 Smart App
Control "will block execution of unsigned files unless the file has a positive reputation"
(https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation). Mitigations:
SignPath signing (reputation then carries across versions); **stop shipping 34 releases in 17 days** —
every hash restarts at zero, so release fortnightly; promote one file (the installer); publish SHA-256
plus a VirusTotal link per release; put the exact dialog screenshots with arrows on the site's Download
section; the Store later if a parent registers.

**DevForum and the bridge.** Rojo's localhost plugin is the accepted precedent; keep the plugin open
source and on the Creator Store, document Studio's HttpService/plugin permission prompt, never tell users
to disable protection.

**"Is this a virus."** Reply with: source link, GitHub Actions build logs, SHA-256, VirusTotal,
`npm run dist` to build it yourself. Never argue; the chokepoint is that anyone can rebuild it.

**Age and safety.** Say "13-year-old solo maker" at most, nothing else: no name, face, city, school; DMs
off; a parent holds every password and co-owns the Discord; no voice chat, no "collab" or payment
offers; report and move on.

**Burnout.** One recording day, one post, at most one release per fortnight; reply within 24 h, not
instantly; exam weeks are skip weeks; re-plan at day 90 from the numbers.

## Six-week calendar

| Week | Build (1 evening) | Post (1 slot) | Measure |
|---|---|---|---|
| 1 | Clip recorder + corner mark; GitHub Actions build; SHA-256/VirusTotal per release; site: creator line, SmartScreen screenshots, Discord/DevForum links; apply to SignPath; enable Discussions; create Discord (parent co-owner) | Nothing public. Record clips 1–3 | Set up GoatCounter + metrics Action |
| 2 | Release v0.11 (one file promoted) | **DevForum Community Resources launch** (clips 1, 4, 5 GIFs); YouTube #1 "Moon Animator vs Cadence" | Thread views/likes daily; downloads |
| 3 | Fix week-2 bug reports | r/robloxgamedev "I made a free..." (clip 1 video); Short from clip 7 | Upvotes, comments answered <24 h |
| 4 | Effect Sheet beta | DevForum reply: changelog + clip 7 GIF; YouTube #2 "Make this VFX in 40 seconds"; awesome-roblox PRs | **Day-30 check** vs targets |
| 5 | Ship first community `.cfx` in recipes | Discord showcase posts; Short (clip 2) | Discord joins; `.cfx` submissions |
| 6 | Release v0.12 | Community Tutorials thread "Walk cycle in Cadence in 5 minutes" (clip 8); Reddit (clip 5, Moon export pain); YouTube #3 (clip 9, Claude) | Traffic sources; decide weeks 7–12 by what moved |

## The 10 first clips

1. "Good VFX with just particle emitters?" — a fire/smoke recipe exported as native ParticleEmitters, playing in Studio.
2. Textures without After Effects — procedural texture → PNG → emitter texture, 30 s.
3. Mesh-style VFX without Blender — SDF/trail/beam sword-slash ring.
4. Timing an effect to an attack without scripts — effect attached to the swing on the timeline, exported.
5. "Moon export plays wrong in game" → Cadence's baked-easing export playing identically (before/after).
6. Same Moon keybinds, 20 s, no narration.
7. One value → whole effect (Effect Sheet "how does it vary" menu with live thumbnails).
8. Onion skin + IK walk cycle in 30 s.
9. "Claude animates my rig" — prompt → result → `validate_animation`.
10. The honest install video: the SmartScreen screen, why it appears, SHA-256 check, `npm run dist`.
