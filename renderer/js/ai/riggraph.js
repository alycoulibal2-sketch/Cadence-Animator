// The Rig Graph (directive Part 18).
//
// Part 18: "The Rig Graph is not simply a tree of Roblox joints. It must expose the meaning and
// capabilities of a rig."
//
// Cadence's own rig data answers *topology* (which part connects to which, through what offsets).
// It does not answer capability: which joints are mirrors of each other, which limb can reach a
// contact, whether a joint's own axes are aligned with its parent's, which control strategy suits
// a target, or whether the rig is internally consistent at all. Those are what this module adds.
//
// Two rules the projection follows throughout:
//
//   * Unknown is reported as `null`, never as a default. `joint_limits` is `null` because Cadence
//     stores no joint limits — that is different from "this joint has no limits", and a planner
//     that confuses the two will happily generate a knee that bends backwards.
//
//   * Every derived claim carries where it came from. A `semantic_role` from an exact Roblox name
//     match and one from a token guess are both present in the same field, distinguished by
//     `role_source` and `role_certainty` rather than by the caller having to know.

import * as CF from '../cf.js';
import * as ids from './ids.js';
import * as roles from './roles.js';
import { ROLE, SIDE } from './roles.js';
import { contentHash } from './hash.js';
import { CERTAINTY, evidence, finding, sortFindings, summarise, coverage } from './certainty.js';
import { buildSolvePlan, solveWorlds, distance } from './kinematics.js';

/** How far up from a contact-capable tip an IK chain is considered to run. Matches the app's own
 *  default (`state.ikChainLength`), which is what `solve_ik` uses when no length is given. */
const DEFAULT_IK_CHAIN = 3;

/** Rotation part of a CFrame is (near) identity. The tolerance matches `validate.js`'s
 *  orthonormality slack, so the two modules agree about what counts as "clean" rig data. */
function rotationIsIdentity(cf) {
  const r = [cf[3], cf[4], cf[5], cf[6], cf[7], cf[8], cf[9], cf[10], cf[11]];
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return r.every((v, i) => Math.abs(v - I[i]) < 1e-4);
}

/**
 * Project one item's rig into the Rig Graph.
 *
 * @param project the whole project (needed for role overrides, which live in `project.semantics`)
 * @param item    the rig item
 * @param opts.ikChainLength how many joints up from a tip count as an IK chain (default 3)
 */
export function rigGraph(project, item, { ikChainLength = DEFAULT_IK_CHAIN } = {}) {
  if (!item || !item.rig) return null;
  const rig = item.rig;
  const tracks = (project.tracks && project.tracks[item.id]) || {};

  const partList = rig.parts || [];
  const jointList = rig.joints || [];
  const motors = jointList.filter((j) => j.kind !== 'weld');
  const welds = jointList.filter((j) => j.kind === 'weld');

  const partById = new Map(partList.map((p) => [p.id, p]));
  const motorByPart1 = new Map();
  for (const j of motors) if (!motorByPart1.has(j.part1)) motorByPart1.set(j.part1, j);
  const childrenOfPart = new Map();
  for (const j of jointList) {
    if (!childrenOfPart.has(j.part0)) childrenOfPart.set(j.part0, []);
    childrenOfPart.get(j.part0).push(j);
  }

  // ---------------------------------------------------------------- parts
  const parts = partList.map((p) => {
    const r = roles.partRole(project, item, p);
    const driver = motorByPart1.get(p.id) || null;
    const mirror = roles.mirrorName(p.name || p.id);
    const mirrorPart = mirror ? (partList.find((q) => (q.name || q.id) === mirror) || null) : null;
    return {
      id: ids.partId(item.id, p.id),
      name: p.name || p.id,
      roblox_mapping: { partId: p.id, className: p.className || null, meshId: p.meshId || null },
      semantic_role: r.role,
      side: r.side,
      role_source: r.source,
      role_certainty: r.certainty,
      role_confidence: r.confidence,
      role_evidence: r.evidence,
      size: p.size || null,
      rest_cframe: p.cf || null,
      driven_by: driver ? ids.jointId(item.id, driver) : null,
      drives: (childrenOfPart.get(p.id) || []).map((j) => ids.jointId(item.id, j)),
      mirror_partner: mirrorPart ? ids.partId(item.id, mirrorPart.id) : null,
      contact_capability: roles.isContactCapable(r.role),
      is_root: p.id === rig.rootPart,
      revision: contentHash(p),
    };
  });
  const partNodeById = new Map(parts.map((p) => [p.roblox_mapping.partId, p]));

  // ---------------------------------------------------------------- FK chains
  // The joint path from the root part down to each part. This is `FK_chain_membership`, and it is
  // also what tells a planner that moving the shoulder moves the hand.
  const fkPathTo = new Map(); // partId -> [joint, …] root-first
  {
    const queue = [rig.rootPart];
    fkPathTo.set(rig.rootPart, []);
    const guard = new Set([rig.rootPart]);
    while (queue.length) {
      const cur = queue.shift();
      for (const j of childrenOfPart.get(cur) || []) {
        if (guard.has(j.part1)) continue; // a cycle; reported by validation, not followed here
        guard.add(j.part1);
        fkPathTo.set(j.part1, [...fkPathTo.get(cur), j]);
        queue.push(j.part1);
      }
    }
  }

  // ---------------------------------------------------------------- IK chains
  // A chain is named for the tip it reaches. Built exactly the way `ik.js buildChain` builds it —
  // walk motors upward from the tip part, stop at the root or at `ikChainLength` — so what this
  // graph advertises as IK-controllable is precisely what `solve_ik` can actually solve.
  const ikChains = [];
  for (const p of partList) {
    const pr = partNodeById.get(p.id);
    if (!pr || !pr.contact_capability) continue;
    const chain = [];
    let cur = p.id;
    while (chain.length < Math.max(1, ikChainLength)) {
      const j = motorByPart1.get(cur);
      if (!j) break;
      chain.push(j);
      cur = j.part0;
      if (cur === rig.rootPart) break;
    }
    if (chain.length >= 2) {
      ikChains.push({
        id: `ikchain:${item.id}/${p.id}`,
        tip_part: ids.partId(item.id, p.id),
        tip_role: pr.semantic_role,
        side: pr.side,
        joints: chain.map((j) => ids.jointId(item.id, j)),
        joint_names: chain.map((j) => j.name),
        length: chain.length,
        solver: 'ccd',
        note: 'position-reaching; the tip joint can also control twist about the reach axis (see ik.js), not arbitrary 3-axis orientation',
      });
    }
  }
  const ikMembership = new Map(); // jointName -> [chainId]
  for (const c of ikChains) {
    for (const n of c.joint_names) {
      if (!ikMembership.has(n)) ikMembership.set(n, []);
      ikMembership.get(n).push(c.id);
    }
  }

  // ---------------------------------------------------------------- joints
  const components = jointList.map((j) => {
    const r = roles.jointRole(project, item, j);
    const isMotor = motorByPart1.get(j.part1) === j;
    const track = tracks[j.name] || null;
    const mirror = roles.mirrorName(j.name);
    const mirrorJoint = mirror ? (jointList.find((k) => k.name === mirror) || null) : null;
    const path = fkPathTo.get(j.part1) || null;
    const restAligned = rotationIsIdentity(j.c0) && rotationIsIdentity(j.c1);
    const inIk = ikMembership.get(j.name) || [];

    // Part 32: "Always expose the chosen control strategy in the plan." The graph does not choose
    // — it states what is available and which is preferable, and says why.
    const controls = [];
    if (isMotor) controls.push('fk');
    if (isMotor && inIk.length) controls.push('ik');
    if (!isMotor) controls.push('rigid');

    return {
      id: ids.jointId(item.id, j),
      name: j.name,
      semantic_role: r.role,
      side: r.side,
      role_source: r.source,
      role_certainty: r.certainty,
      role_confidence: r.confidence,
      role_evidence: r.evidence,

      parent_component: path && path.length > 1 ? ids.jointId(item.id, path[path.length - 2]) : null,
      child_components: (childrenOfPart.get(j.part1) || []).map((k) => ids.jointId(item.id, k)),

      part0: ids.partId(item.id, j.part0),
      part1: ids.partId(item.id, j.part1),

      // Part 18 `rest_pose`: a joint track stores a DELTA from rest, so the rest transform is
      // identity by construction. C0/C1 are the bind offsets that delta is applied between.
      rest_pose: { c0: j.c0, c1: j.c1, transform: CF.IDENTITY.slice() },

      // Part 18 `local_axis_convention`. `rest-aligned` means C0 and C1 carry no rotation, so the
      // joint's own axes coincide with its parent's at rest — which is the assumption
      // `validate.js`'s hinge-misalignment check depends on. A `rotated-bind` joint is still
      // perfectly animatable; it just makes axis-based heuristics weaker, and saying so here is
      // how a caller knows not to trust them.
      local_axis_convention: restAligned ? 'rest-aligned' : 'rotated-bind',
      rotation_representation: 'cframe-3x3-delta-from-rest',

      // Cadence stores no joint limits. `null` means UNKNOWN, not unlimited.
      joint_limits: null,

      available_controls: controls,
      IK_chain_membership: inIk,
      FK_chain_membership: path ? path.map((k) => ids.jointId(item.id, k)) : null,
      chain_depth_from_root: path ? path.length : null,
      role_chain_depth: roles.chainDepth(r.role),

      // Part 18 `space_switches` — Cadence's "unparented animation": a track in world space stores
      // origin-relative part CFrames instead of parent-relative transforms.
      space_switches: isMotor ? ['parent', 'origin'] : [],
      current_space: track && track.space === 'world' ? 'origin' : 'parent',
      preferred_motion_space: preferredSpace(r.role, isMotor),

      constraint_ids: [], // Part 20.6 — nothing compiles constraints yet (Phase 2)

      mirror_partner: mirrorJoint ? ids.jointId(item.id, mirrorJoint) : null,
      contact_capability: !!(partNodeById.get(j.part1) || {}).contact_capability,

      roblox_mapping: {
        jointName: j.name,
        className: isMotor ? 'Motor6D' : 'Weld',
        part0: j.part0,
        part1: j.part1,
        trackName: isMotor ? j.name : null, // welds are not animatable, so they own no track
      },

      animated: !!(track && track.keys && track.keys.length),
      key_count: track && track.keys ? track.keys.length : 0,
      revision: contentHash(j),
    };
  });

  // ---------------------------------------------------------------- role index
  const byRole = {};
  for (const p of parts) (byRole[p.semantic_role] ||= { parts: [], joints: [] }).parts.push(p.id);
  for (const c of components) (byRole[c.semantic_role] ||= { parts: [], joints: [] }).joints.push(c.id);

  const graph = {
    id: `riggraph:${item.id}`,
    itemId: item.id,
    entityId: ids.itemId(item),
    name: item.name,
    rig_type: rig.rigType || null,
    root_part: rig.rootPart ? ids.partId(item.id, rig.rootPart) : null,
    root_part_name: rig.rootPart || null,
    counts: { parts: partList.length, joints: jointList.length, motors: motors.length, welds: welds.length },
    parts,
    components,
    ik_chains: ikChains,
    roles: byRole,
    id_durability: {
      part: ids.idDurability('part'),
      joint: ids.idDurability('joint'),
    },
    limitations: rigLimitations(rig, parts, components),
  };

  graph.validation = validateRig(project, item, graph);
  graph.revision = contentHash({ parts: rig.parts, joints: rig.joints, rootPart: rig.rootPart, rigType: rig.rigType });
  return graph;
}

// Part 32: which space a role is usually best animated in. Advisory, and labelled as such by
// living next to `space_switches` rather than replacing it.
function preferredSpace(role, isMotor) {
  if (!isMotor) return null;
  switch (role) {
    case ROLE.FOOT: case ROLE.ANKLE: case ROLE.HAND: case ROLE.WRIST:
      return 'origin'; // contact-bearing tips hold position better authored in rig space
    default:
      return 'parent';
  }
}

function rigLimitations(rig, parts, components) {
  const out = [];
  const guessed = [...parts, ...components].filter((n) => n.role_source === 'token').length;
  const unknown = [...parts, ...components].filter((n) => n.role_source === 'none').length;
  if (guessed) out.push(`${guessed} of ${parts.length + components.length} role mappings come from naming convention, not a known rig standard — treat them as "possible", or pin them with set_semantic_role`);
  if (unknown) out.push(`${unknown} node(s) have no recognisable role; semantic selection cannot address them until a role is pinned`);
  out.push('joint_limits is null on every joint: Cadence stores no joint limits, so "unknown" is the honest answer — do not read it as "unlimited"');
  if (!rig.rigType) out.push('the rig declares no rigType, so role matches could not be cross-checked against a known standard');
  return out;
}

// ---------------------------------------------------------------- validation (Part 18)
//
// "Before generating a motion plan, validate: root availability; body-role mapping; joint
// orientation assumptions; animation layer compatibility; required weapon or prop attachment
// points; contact targets; any existing constraints; current pose validity; exportability."
//
// Each check returns findings with a certainty label. Nothing here mutates anything, and nothing
// here claims to have checked something it did not — the `coverage.notRun` list names what a
// caller still has to establish some other way.

export function validateRig(project, item, graph = null) {
  const g = graph || rigGraph(project, item);
  const rig = item.rig;
  const F = [];

  // --- root availability
  const rootDef = (rig.parts || []).find((p) => p.id === rig.rootPart);
  if (!rig.rootPart) {
    F.push(finding({
      id: 'RIG-ROOT-MISSING', certainty: CERTAINTY.CERTAIN,
      statement: 'The rig declares no root part.',
      evidence: [evidence('absence', 'rig.rootPart is empty')],
      suggestion: { text: 'Set a root part; nothing can be solved or exported without one.', reversible: true },
    }));
  } else if (!rootDef) {
    F.push(finding({
      id: 'RIG-ROOT-DANGLING', certainty: CERTAINTY.CERTAIN,
      statement: `The declared root part "${rig.rootPart}" is not in the part list.`,
      evidence: [evidence('absence', `no part has id "${rig.rootPart}"`)],
    }));
  }

  // --- duplicate motors on one part (state.js forbids creating these, but an imported or
  //     hand-edited rig can still carry them, and the solver silently ignores the second one)
  const seenPart1 = new Map();
  for (const j of (rig.joints || []).filter((k) => k.kind !== 'weld')) {
    if (seenPart1.has(j.part1)) {
      F.push(finding({
        id: 'RIG-DOUBLE-MOTOR', certainty: CERTAINTY.CERTAIN,
        statement: `"${j.part1}" is driven by two Motor6Ds ("${seenPart1.get(j.part1)}" and "${j.name}"); only the first one animates.`,
        evidence: [evidence('data', `both joints declare part1 = "${j.part1}"`),
          evidence('inference', 'the solver takes the first motor per part1 and treats the rest as rigid offsets')],
      }));
    } else seenPart1.set(j.part1, j.name);
  }

  // --- cycles and orphans
  const plan = buildSolvePlan(rig);
  if (plan.unreached.length) {
    F.push(finding({
      id: 'RIG-UNREACHED', certainty: CERTAINTY.CERTAIN,
      statement: `${plan.unreached.length} part(s) are never reached from the root and have no rigid fallback: ${plan.unreached.join(', ')}.`,
      evidence: [evidence('measurement', `${plan.unreached.length} of ${(rig.parts || []).length} parts unsolved`)],
    }));
  }
  if (plan.staticParts.length) {
    F.push(finding({
      id: 'RIG-STATIC-PARTS', certainty: CERTAINTY.CERTAIN,
      statement: `${plan.staticParts.length} part(s) are connected by no joint and simply ride the root: ${plan.staticParts.map((s) => s.id).join(', ')}.`,
      evidence: [evidence('data', 'no joint lists these parts as part1')],
      suggestion: { text: 'Intentional for scenery welded to the rig; a mistake if one of these was meant to animate.', reversible: true },
    }));
  }

  // --- rest-pose consistency
  //
  // A rig carries the same geometry twice: each part's rest CFrame (`part.cf`) and each joint's
  // bind offsets (`c0`/`c1`). Solving the chain from the root with an identity pose must land
  // every part back on its own rest CFrame, because that is what "rest" means.
  //
  // When it does not, the rig still LOOKS right — the viewport renders from the FK solve, so the
  // joint offsets win — but anything that reads `part.cf` is working from stale numbers. In
  // particular `state.js addJoint` derives a new joint's C0 as `P0rest⁻¹ · P1rest`, so creating a
  // joint on an inconsistent rig places the child wherever the stale rest data says, and the part
  // visibly jumps when the new joint takes over.
  if (rootDef) {
    const worlds = solveWorlds(plan, {}, rootDef.cf, null);
    const drift = [];
    for (const p of rig.parts || []) {
      const w = worlds.get(p.id);
      if (!w || !p.cf) continue;
      const d = distance(w, p.cf);
      if (d > 1e-3) drift.push({ part: p.id, studs: +d.toFixed(4) });
    }
    if (drift.length) {
      drift.sort((a, b) => b.studs - a.studs);
      F.push(finding({
        id: 'RIG-REST-INCONSISTENT', certainty: CERTAINTY.CERTAIN,
        statement: `${drift.length} part(s) have a rest CFrame that disagrees with the joint chain, by up to ${drift[0].studs} studs (worst: ${drift[0].part}).`,
        evidence: [
          evidence('measurement', 'solved the joint chain from the root with an identity pose and compared each part against its own rest CFrame',
            drift.slice(0, 6)),
          evidence('inference', 'the viewport renders from the joint chain, so the rig still looks correct; only code that reads part.cf is affected'),
          evidence('data', 'state.js addJoint derives a new joint C0 as P0rest⁻¹·P1rest, so joints created on this rig will be offset by the same amount'),
        ],
        suggestion: {
          text: 'Rebuild the rest CFrames from the joint chain, or re-capture the rig from Studio. Until then, avoid creating joints on this rig, and treat part.cf as unreliable.',
          reversible: true,
        },
      }));
    }
  }

  // --- body-role mapping
  const unmapped = [...g.parts, ...g.components].filter((n) => n.role_source === 'none');
  const guessed = [...g.parts, ...g.components].filter((n) => n.role_source === 'token');
  if (unmapped.length) {
    F.push(finding({
      id: 'RIG-ROLE-UNMAPPED', certainty: CERTAINTY.USER_INTENT_REQUIRED,
      statement: `${unmapped.length} node(s) have no recognisable semantic role: ${unmapped.slice(0, 8).map((n) => n.name).join(', ')}${unmapped.length > 8 ? '…' : ''}.`,
      evidence: [evidence('absence', 'no exact rig-standard name match and no naming-convention token match')],
      suggestion: { text: 'Pin the ones that matter with set_semantic_role; semantic selection cannot address them otherwise.', reversible: true },
    }));
  }
  if (guessed.length) {
    F.push(finding({
      id: 'RIG-ROLE-GUESSED', certainty: CERTAINTY.POSSIBLE,
      statement: `${guessed.length} role mapping(s) come from a naming convention rather than a known rig standard.`,
      evidence: [evidence('convention', 'matched by token', guessed.slice(0, 8).map((n) => `${n.name} → ${n.semantic_role}`))],
    }));
  }

  // --- joint orientation assumptions
  const rotatedBind = g.components.filter((c) => c.local_axis_convention === 'rotated-bind' && c.roblox_mapping.className === 'Motor6D');
  if (rotatedBind.length) {
    F.push(finding({
      id: 'RIG-ROTATED-BIND', certainty: CERTAINTY.CERTAIN,
      statement: `${rotatedBind.length} motor(s) have a rotated bind pose (C0 or C1 carries rotation).`,
      evidence: [evidence('data', 'C0/C1 rotation is not identity', rotatedBind.slice(0, 8).map((c) => c.name))],
      suggestion: {
        text: 'Animation is unaffected. Axis-based heuristics are: validate_animation\'s hinge-misalignment check assumes rest-aligned axes and is weaker on these joints.',
        reversible: null,
      },
    }));
  }

  // --- mirror completeness
  const lonely = g.components.filter((c) => c.side && c.side !== SIDE.CENTRE && !c.mirror_partner);
  if (lonely.length) {
    F.push(finding({
      id: 'RIG-MIRROR-INCOMPLETE', certainty: CERTAINTY.HIGHLY_LIKELY,
      statement: `${lonely.length} sided joint(s) have no mirror partner: ${lonely.map((c) => c.name).join(', ')}.`,
      evidence: [evidence('absence', 'no joint exists under the mirrored name')],
      suggestion: { text: 'Deliberate for an asymmetric character; otherwise mirror_item will not be able to mirror these.', reversible: null },
    }));
  }

  // --- contact targets
  const contactTips = g.parts.filter((p) => p.contact_capability);
  if (!contactTips.length) {
    F.push(finding({
      id: 'RIG-NO-CONTACT-PARTS', certainty: CERTAINTY.HIGHLY_LIKELY,
      statement: 'No part on this rig is contact-capable, so contact planning and "the planted foot" cannot resolve.',
      evidence: [evidence('absence', 'no part resolved to a hand, foot, toe, finger or whole limb role')],
    }));
  }

  // --- exportability
  if (!rig.rigType) {
    F.push(finding({
      id: 'RIG-NO-RIGTYPE', certainty: CERTAINTY.CERTAIN,
      statement: 'The rig declares no rigType.',
      evidence: [evidence('absence', 'rig.rigType is empty')],
      suggestion: { text: 'Export still works; role inference just cannot be cross-checked against a standard.', reversible: null },
    }));
  }
  const dupNames = new Map();
  for (const j of rig.joints || []) dupNames.set(j.name, (dupNames.get(j.name) || 0) + 1);
  const clashes = [...dupNames].filter(([, n]) => n > 1).map(([n]) => n);
  if (clashes.length) {
    F.push(finding({
      id: 'RIG-JOINT-NAME-CLASH', certainty: CERTAINTY.CERTAIN,
      statement: `Duplicate joint name(s): ${clashes.join(', ')}. Joint tracks are keyed by name, so these share one track.`,
      evidence: [evidence('data', 'the same name appears on more than one joint'),
        evidence('inference', 'project.tracks[itemId] is keyed by joint name — two joints with one name cannot be animated independently')],
    }));
  }

  const findings = sortFindings(F);
  return {
    findings,
    summary: summarise(findings),
    coverage: coverage({
      scope: `rig "${item.name}": ${g.counts.parts} parts, ${g.counts.joints} joints`,
      frames: null,
      loop: 'full',
      notRun: [
        'current pose validity: whether the posed rig is BALANCED needs a centre of mass and a support polygon, and part mass is unknown (MOT-011). Per-frame velocity and contact drift are measurable now (analyze_motion, analyze_contacts) but they judge the animation, not the rig, so they are not run here',
        'animation-layer compatibility (Cadence has no animation layers)',
        'weapon/prop attachment points (needs a declared prop requirement — Phase 3)',
        'existing constraints (nothing compiles constraints yet — Phase 2)',
        'a real Studio round-trip (only the shape is checked here, not Studio\'s acceptance of it)',
      ],
    }),
  };
}
