// Reference motion and style transfer (directive Part 36). REF-001, REF-002.
//
// Part 36 lists seven kinds of reference a user might supply: existing Cadence animations, Roblox
// animations, video, pose sequences, reference renders, approved prior shots, style boards, effect
// references. This file builds a profile from ONE of them: an existing animation item, either
// elsewhere in the same project or in a second already-loaded Cadence project object.
//
// Three more arrive through `ai/library.js` and the two import tools, and they arrive AS an
// in-project item, which is why this file needed no new code path for them: a Roblox animation
// file or AnimSave used as a MOTION source, an approved prior shot (accept_shot → add_to_library,
// provenance `authored`), and video — indirectly, because Roblox Studio's Animation Capture does
// the estimating and Cadence imports its keyframes, labelled `estimated` at every step. Nothing
// here looks at a video frame. Pose sequences, reference renders and style boards are still
// unsupported and named absent in `referenceLimitations()` rather than stubbed.
//
// The one thing this file does NOT do is re-derive motion measurement. `buildReferenceProfile`
// calls `ai/motion.js sampleMotion` for the raw per-frame numbers and only maps its OUTPUT onto
// Part 36's profile dimensions. `motion.js` already names "no comparison against a reference motion
// (REF-001)" in its own `coverage.notRun` — this file is what that line was waiting on, and it is
// built as a consumer of that module, not a second measurement engine.
//
// Part 36's own closing requirement — "clearly separate reference characteristics to emulate from
// details intentionally not copied" (REF-002) — is not something Cadence can decide FOR a user.
// Which characteristics to keep is exactly the kind of subjective, user-intent-required judgement
// Part 13 forbids automating, so `emulate` / `not_copied` are fields the CALLER declares, carried
// through verbatim, never inferred from the measured dimensions.
//
// Pure at load like the rest of `ai/`.

import { sampleMotion } from './motion.js';
import { resolveStyle } from './style.js';
import { contentHash, shortHash } from './hash.js';

const PROFILE_DIMENSIONS = Object.freeze([
  'timing', 'spacing', 'energy', 'weight', 'anticipation', 'impact_contrast', 'overshoot',
  'recovery', 'arc_quality', 'pose_density', 'silhouette_behavior', 'camera_behavior',
  'vfx_rhythm', 'lighting_and_color_tendencies', 'style_cues',
]);

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function stddev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
function round3(v) { return v === null || v === undefined ? null : Math.round(v * 1000) / 1000; }

function markersNear(project, itemId, names, range) {
  const marks = (project.markers?.[itemId] || []).filter((m) => (!range || (m.t >= range[0] && m.t <= range[1])) && names.includes((m.name || '').toLowerCase()));
  return marks.map((m) => ({ name: m.name, t: m.t }));
}

/**
 * Build a Part 36 reference profile from one item's already-authored motion.
 *
 * @param sourceProject  the project the reference LIVES in — may be the same project the caller is
 *                        about to edit, or a second, already-loaded `.cadence` project object
 * @param opts.itemId    the reference item within `sourceProject`
 * @param opts.frameRange [from, to], defaults to the item's full track range via sampleMotion
 * @param opts.targetProject / opts.targetItemId  optional — if given, `adaptation_needed` compares
 *                        real structural facts (rig type, fps, duration) rather than reporting
 *                        "not compared"
 */
export function buildReferenceProfile(sourceProject, {
  itemId, frameRange = null, targetProject = null, targetItemId = null,
  emulate = [], notCopied = [], label = null,
} = {}) {
  const motion = sampleMotion(sourceProject, { itemId, frameRange });
  const range = motion.range;

  const dims = {};

  // timing (measured — key density and per-subject onset/peak already come out of sampleMotion)
  dims.timing = {
    measured: true,
    key_density: motion.key_density,
    onset_frames: motion.subjects.map((s) => ({ part: s.part_id, onset_frame: s.summary.onset_frame, peak_speed_frame: s.summary.peak_speed_frame })),
  };

  // spacing (measured — coefficient of variation of per-frame speed; a real, simple statistic, not
  // a claim that this equals the classical "spacing" concept exactly)
  dims.spacing = {
    measured: true,
    method: 'coefficient of variation (stddev/mean) of per-frame speed, per subject — higher means less even travel',
    per_subject: motion.subjects.map((s) => {
      const speeds = s.samples.map((x) => x.speed).filter((x) => x !== null);
      const m = mean(speeds), sd = stddev(speeds);
      return { part: s.part_id, mean_speed: round3(m), variability: m ? round3(sd / m) : null };
    }),
  };

  // energy (measured but explicitly UNNORMALIZED — no cross-project scale exists to normalize
  // against, and inventing one would be exactly the "opaque single slider" Part 21 forbids for a
  // different reason)
  dims.energy = {
    measured: true,
    normalized: false,
    reason_not_normalized: 'no reference scale exists to normalize peak speed/angular speed against across projects',
    per_subject: motion.subjects.map((s) => ({ part: s.part_id, peak_speed: s.summary.peak_speed, peak_angular_speed_deg: s.summary.peak_angular_speed_deg })),
  };

  // weight (not measured — needs a declared contact or part mass, neither generically available)
  dims.weight = { measured: false, reason: 'weight needs a declared ContactSpec (measureContactDrift) or part mass; neither is available for an arbitrary reference range without the caller declaring a contact separately' };

  // anticipation / impact_contrast (measured ONLY where markers name them — the same evidence-bound
  // phase-naming rule Phase 3's ai/cal.js already uses: declared = certain, nothing else is guessed)
  const anticipationMarks = markersNear(sourceProject, itemId, ['anticipation', 'anticipate'], range);
  dims.anticipation = anticipationMarks.length
    ? { measured: true, evidence: 'declared marker', markers: anticipationMarks }
    : { measured: false, reason: 'no marker named "anticipation" in range — phase segmentation without a declared boundary is not confident enough to name a span (Part 20.2\'s own evidence rule)' };

  const impactMarks = markersNear(sourceProject, itemId, ['impact', 'hit', 'contact'], range);
  if (impactMarks.length) {
    const t = impactMarks[0].t;
    const perSubject = motion.subjects.map((s) => {
      const near = s.samples.find((x) => Math.abs(x.t - t) < 1e-6) || s.samples.reduce((best, x) => (best === null || Math.abs(x.t - t) < Math.abs(best.t - t) ? x : best), null);
      return { part: s.part_id, jerk_at_impact: near?.jerk ?? null, acceleration_at_impact: near?.acceleration ?? null };
    });
    dims.impact_contrast = { measured: true, evidence: 'declared marker', at: t, per_subject: perSubject };
  } else {
    dims.impact_contrast = { measured: false, reason: 'no marker named "impact" (or "hit"/"contact") in range' };
  }

  // overshoot (not measured — needs a declared target position, which nothing in Cadence models)
  dims.overshoot = { measured: false, reason: 'overshoot is passing beyond a target before returning to it; Cadence has no declared target position for an arbitrary motion to be measured against' };

  // recovery (measured — a simple settle-duration proxy from motion.js's own `still` flag)
  dims.recovery = {
    measured: true,
    method: 'frames between this subject\'s peak-speed frame and the end of range where the subject reports "still" — a proxy for settle duration, not Part 23\'s own settle_duration dimension (which needs the contact model)',
    per_subject: motion.subjects.map((s) => ({ part: s.part_id, still_by_end: s.summary.still, peak_speed_frame: s.summary.peak_speed_frame })),
  };

  // arc_quality (measured directly — MOT-005's own metric, reused verbatim)
  dims.arc_quality = {
    measured: true,
    method: 'chord-deviation ("bow") and path length per subject, from ai/motion.js — the same measurement analyze_motion already reports',
    per_subject: motion.subjects.map((s) => ({ part: s.part_id, bow_studs: s.summary.bow_studs, path_length_studs: s.summary.path_length_studs })),
  };

  // pose_density (measured directly — sampleMotion already computes it)
  dims.pose_density = { measured: true, key_density: motion.key_density };

  // silhouette_behavior / camera_behavior / vfx_rhythm / lighting_and_color_tendencies — not
  // measurable from project data alone in this build; each is named individually rather than
  // grouped, so a reader sees exactly which capability is missing for each.
  dims.silhouette_behavior = { measured: false, reason: 'a silhouette pass (ai/observe.js) needs a render; nothing in ai/ renders pixels, and comparing an arbitrary reference range would need a baseline taken from it first (create_baseline), a separate step this profile does not perform automatically' };
  dims.camera_behavior = { measured: false, reason: 'no active-camera model exists (same gap named throughout ai/motion.js and ai/cal.js)' };
  dims.vfx_rhythm = { measured: false, reason: 'VFX timing rhythm would come from ai/events.js on the reference item, which this function does not call — a caller wanting it should call describe_shot on the reference item directly' };
  dims.lighting_and_color_tendencies = { measured: false, reason: 'Cadence has no lighting model at all' };

  // style_cues (measured when the SOURCE project declared a style — ai/style.js)
  const sourceStyle = resolveStyle(sourceProject);
  dims.style_cues = sourceStyle
    ? { measured: true, declared_style: sourceStyle }
    : { measured: false, reason: 'the source project never declared a style (ai/style.js setStyle) — nothing infers one' };

  // REF-002: adaptation needed, computed for real when a target is given, named absent otherwise.
  let adaptationNeeded;
  if (targetProject && targetItemId) {
    const srcItem = (sourceProject.items || []).find((i) => i.id === itemId);
    const tgtItem = (targetProject.items || []).find((i) => i.id === targetItemId);
    const findings = [];
    if (srcItem?.rig?.name !== tgtItem?.rig?.name) findings.push(`source rig "${srcItem?.rig?.name ?? 'unknown'}" differs from target rig "${tgtItem?.rig?.name ?? 'unknown'}" — joint names and rest poses may not correspond 1:1`);
    if ((sourceProject.fps ?? null) !== (targetProject.fps ?? null)) findings.push(`source fps ${sourceProject.fps ?? 'unknown'} differs from target fps ${targetProject.fps ?? 'unknown'} — frame-based fields above (onset_frame, peak_speed_frame) do not compare directly without rescaling`);
    const targetStyle = resolveStyle(targetProject);
    if (sourceStyle && targetStyle && sourceStyle !== targetStyle) findings.push(`source style "${sourceStyle}" differs from target's declared style "${targetStyle}" — ai/style.js will apply the TARGET's modifiers to any vocabulary interpretation, not the reference's`);
    adaptationNeeded = { compared: true, findings };
  } else {
    adaptationNeeded = { compared: false, reason: 'no targetProject/targetItemId supplied — pass both to compare rig, fps and declared style for real' };
  }

  return {
    id: `ref:${shortHash(contentHash({ itemId, range, label }))}`,
    label: label ?? null,
    source: { item_id: itemId, item_name: motion.item.name, frame_range: range, fps: sourceProject.fps ?? null },
    dimensions: dims,
    dimension_list: [...PROFILE_DIMENSIONS],
    // REF-002: these three are the user's OWN declaration, not a conclusion this function reaches.
    emulate: [...emulate],
    not_copied: [...notCopied],
    adaptation_needed: adaptationNeeded,
    overfitting_risk: [
      'a profile built from ONE reference range is a sample of one — treating any single number here as a hard target risks reproducing an incidental artifact of that one take rather than the intended quality',
      'copying every measured dimension at once collapses the target character into the reference rather than adapting the reference to the target, which Part 36 explicitly warns against ("risks of overfitting or loss of original character identity")',
    ],
    source_limitations: [
      'this profile is built from IN-PROJECT motion data only — video, external Roblox animation files used as a motion source, pose sequences, reference renders and style boards are not supported (see referenceLimitations())',
      'advisory only: nothing enforces a "strict match" to this profile — Part 36 asks for that separation and no strict-match mode exists to accidentally bypass it',
    ],
    advisory: 'Part 36: reference comparison is advisory unless the user explicitly requests a strict match. Nothing in this build performs a strict match.',
  };
}

// ---------------------------------------------------------------- comparing two profiles
//
// Part 36 asks for a comparison, not a score. These two functions are the ONE place a numeric
// distance between two profiles is computed in this build: `ai/benchmark.js`'s
// `reference_adaptation` benchmark and `ai/library.js`'s nearest-entry search both import them
// rather than carrying a second copy that could disagree — the same "one interpolation primitive"
// discipline `plan.scaleAbout` already holds.
//
// Only 3 of the 15 profile dimensions are numeric enough to subtract: spacing variability, peak
// speed, and peak angular speed, each per subject part. That is a SAMPLE of the profile and never
// the profile, which is why `profileDistance` reports how many values it compared — a distance
// over two keys and a distance over twenty are not the same claim.

/** The numeric slice of a Part 36 profile, flattened to `metric:part` keys. */
export function numericProfile(profile) {
  const out = {};
  for (const s of profile?.dimensions?.spacing?.per_subject || []) if (s.variability !== null) out[`spacing_variability:${s.part}`] = s.variability;
  for (const s of profile?.dimensions?.energy?.per_subject || []) {
    if (s.peak_speed !== null) out[`peak_speed:${s.part}`] = s.peak_speed;
    if (s.peak_angular_speed_deg !== null) out[`peak_angular_speed_deg:${s.part}`] = s.peak_angular_speed_deg;
  }
  return out;
}

/**
 * Mean relative difference over the numeric values the two profiles SHARE.
 *
 * Returns `null` — never 0, never Infinity — when nothing is comparable: two profiles of different
 * rigs share no part names, and a caller that read a 0 there would conclude "identical". Every
 * consumer has to handle the null rather than have it sorted silently.
 */
export function profileDistance(ref, target) {
  return relativeDistance(numericProfile(ref), numericProfile(target));
}

/**
 * The same distance over two already-flattened numeric slices.
 *
 * `ai/library.js` stores the flattened slice on a library entry rather than the whole profile (an
 * index of a hundred entries would otherwise carry a hundred full profiles just to be searchable),
 * and it must get the SAME number a full-profile comparison would give, so both go through here.
 */
export function relativeDistance(a, b) {
  const keys = Object.keys(a).filter((k) => k in b && Math.abs(a[k]) > 1e-9);
  if (!keys.length) return null;
  const rel = keys.map((k) => Math.abs(b[k] - a[k]) / Math.abs(a[k]));
  return { value: Math.round((rel.reduce((x, y) => x + y, 0) / rel.length) * 1e6) / 1e6, keys: keys.length };
}

// ---------------------------------------------------------------- storage

function store(project, { create = false } = {}) {
  if (!project.semantics) {
    if (!create) return null;
    project.semantics = {};
  }
  if (!project.semantics.references) {
    if (!create) return null;
    project.semantics.references = { entries: [] };
  }
  return project.semantics.references;
}

/** Store a built profile on the TARGET project (typically the live project the caller is about to
 *  edit). References are a record ABOUT a source, not state describing the target's own animation —
 *  the same reasoning `ai/snapshot.js NOT_STATE` already applies to baselines and provenance, and
 *  `references` is listed alongside them there and in `state.js undoableSemantics` for that reason. */
export function storeReferenceProfile(targetProject, profile) {
  const s = store(targetProject, { create: true });
  const existing = s.entries.find((e) => e.id === profile.id);
  if (existing) { Object.assign(existing, profile); return { ...existing, deduplicated: true }; }
  s.entries.push({ ...profile });
  return { ...profile, deduplicated: false };
}

export function listReferenceProfiles(project) {
  return store(project)?.entries?.map((e) => ({ ...e })) ?? [];
}

export function getReferenceProfile(project, id) {
  const e = store(project)?.entries?.find((x) => x.id === id);
  return e ? { ...e } : null;
}

export function referenceLimitations() {
  return [
    'This module profiles an in-project animation item and nothing else. Three further Part 36 reference kinds reach it by first BECOMING one, through import_from_studio / import_animation_file / add_to_library: a Roblox animation file or AnimSave, an approved prior shot, and video by way of Roblox Studio\'s own Animation Capture (whose poses are an estimate, carried as provenance `captured` and `estimated: true`). Pose sequences, reference renders and style boards remain unsupported — 4 of 7.',
    'weight, overshoot, silhouette_behavior, camera_behavior, vfx_rhythm and lighting_and_color_tendencies are never measured — each names the specific missing model (contact/mass, target position, a renderer, an active-camera model, ai/events.js not being called here, and no lighting existing at all, respectively).',
    'anticipation and impact_contrast are measured ONLY when the source range carries a marker literally named for them — nothing infers a phase boundary that was not declared.',
    'emulate / not_copied / adaptation_needed are the caller\'s own declarations or a structural comparison against a supplied target; nothing here decides WHICH measured characteristics are worth keeping.',
    'There is no strict-match mode. Part 36 requires comparison to be advisory unless a strict match is explicitly requested; since no strict-match tool exists, every comparison is advisory by construction, not by a flag that could be forgotten.',
  ];
}
