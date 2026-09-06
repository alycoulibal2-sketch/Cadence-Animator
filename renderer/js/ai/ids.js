// Stable entity identifiers (directive Part 16).
//
// "Do not use a display name as the primary identifier. Names can change, duplicate, or be
// localized. The stable identifier must survive renaming and user-interface rearrangement."
//
// Cadence today only half-satisfies that: items carry a real UUID and parts carry a `part.id`,
// but joints are addressed by `joint.name` and the whole track table is keyed by that same
// string, and keyframes have no identity beyond their time. Re-keying the track table is a
// destructive migration across state.js, io.js, the timeline, the curve editor, the Studio bridge
// and every saved project file — `docs/animation-intelligence/00-foundation-audit.md` §5 records
// the decision not to do it.
//
// So this module DERIVES ids instead, and is explicit about what each one survives:
//
//   item   `item:<uuid>`                        survives everything (native UUID)
//   part   `part:<itemUuid>/<partId>`           survives a part rename (part.id is not the name)
//   joint  `joint:<itemUuid>/<part0>-><part1>`  survives a joint RENAME, because it is derived
//                                               from rig topology and not from joint.name
//   track  `track:<itemUuid>/<trackName>`       does NOT survive a joint rename — the track table
//                                               is name-keyed, so the rename IS a re-key
//   key    `key:<itemUuid>/<trackName>@<t>`     does not survive a move; keys have no identity
//
// A caller that needs to know whether an id is durable should ask `idDurability()` rather than
// assume. Nothing in this layer pretends a derived id is a native one.

const SEP = '/';

// Percent-encoding every segment means a part called "Left/Right Split" cannot forge a different
// entity's id. Only the characters that would break parsing are encoded, so ids stay readable.
function seg(s) {
  return String(s).replace(/[%/:>@]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function unseg(s) {
  return String(s).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function itemId(item) {
  const id = typeof item === 'string' ? item : item?.id;
  if (!id) throw new TypeError('itemId: item has no id');
  return `item:${seg(id)}`;
}

export function partId(itemUuid, partIdRaw) {
  return `part:${seg(itemUuid)}${SEP}${seg(partIdRaw)}`;
}

/**
 * A joint's id comes from the two parts it connects, not from its name. Two joints in one rig
 * cannot legally share a `part1` — `state.js`'s `addJoint` refuses a second motor driving the
 * same part — so `part0->part1` is unique per rig for motors. Welds can share a part1 with a
 * motor, so the kind is folded in to keep those distinct.
 */
export function jointId(itemUuid, joint) {
  const kind = joint.kind === 'weld' ? 'weld' : 'motor';
  return `joint:${seg(itemUuid)}${SEP}${seg(joint.part0)}->${seg(joint.part1)}${SEP}${kind}`;
}

export function trackId(itemUuid, trackName) {
  return `track:${seg(itemUuid)}${SEP}${seg(trackName)}`;
}

export function keyId(itemUuid, trackName, t) {
  return `key:${seg(itemUuid)}${SEP}${seg(trackName)}@${t}`;
}

export function markerId(itemUuid, t) {
  return `marker:${seg(itemUuid)}@${t}`;
}

export function projectId(project) {
  return `project:${seg(project?.id || 'unsaved')}`;
}

/** Parse any id produced above back into its parts. Returns null for anything unrecognised. */
export function parseId(id) {
  if (typeof id !== 'string') return null;
  const c = id.indexOf(':');
  if (c === -1) return null;
  const type = id.slice(0, c);
  const rest = id.slice(c + 1);
  const bits = rest.split(SEP);
  switch (type) {
    case 'project': return { type, projectId: unseg(bits[0]) };
    case 'item': return { type, itemId: unseg(bits[0]) };
    case 'part': return bits.length === 2 ? { type, itemId: unseg(bits[0]), partId: unseg(bits[1]) } : null;
    case 'joint': {
      if (bits.length !== 3) return null;
      const [p0, p1] = bits[1].split('->');
      if (p1 === undefined) return null;
      return { type, itemId: unseg(bits[0]), part0: unseg(p0), part1: unseg(p1), kind: bits[2] };
    }
    case 'track': return bits.length === 2 ? { type, itemId: unseg(bits[0]), track: unseg(bits[1]) } : null;
    case 'key': {
      if (bits.length !== 2) return null;
      const at = bits[1].lastIndexOf('@');
      if (at === -1) return null;
      return { type, itemId: unseg(bits[0]), track: unseg(bits[1].slice(0, at)), t: Number(bits[1].slice(at + 1)) };
    }
    case 'marker': {
      const at = rest.lastIndexOf('@');
      if (at === -1) return null;
      return { type, itemId: unseg(rest.slice(0, at)), t: Number(rest.slice(at + 1)) };
    }
    default: return null;
  }
}

/**
 * What an id survives. Reported alongside every graph so a caller storing an id long-term knows
 * whether it can trust it — Part 4.7: define the limitation rather than hide it.
 */
export function idDurability(type) {
  switch (type) {
    case 'project':
    case 'item':
      return { native: true, survives: ['rename', 'reparent', 'save/load'], survivesNot: [] };
    case 'part':
      return { native: true, survives: ['rename', 'save/load'], survivesNot: ['re-import of the rig under new part ids'] };
    case 'joint':
      return {
        native: false,
        survives: ['joint rename', 'save/load'],
        survivesNot: ['re-parenting the joint to different parts (that is a different joint)'],
        note: 'derived from rig topology because joints carry no native id — see docs/animation-intelligence/00-foundation-audit.md §5',
      };
    case 'track':
      return {
        native: false,
        survives: ['save/load'],
        survivesNot: ['renaming the joint the track drives — the track table is name-keyed, so a rename re-keys the track'],
      };
    case 'key':
      return {
        native: false,
        survives: ['save/load while the key stays at the same time'],
        survivesNot: ['moving the key', 'retiming the track', 'any frame-range operation'],
        note: 'keyframes have no identity in Cadence; (itemId, track, t) is the addressing every existing mutator already uses',
      };
    case 'marker':
      return { native: false, survives: ['save/load'], survivesNot: ['moving the marker'] };
    default:
      return { native: false, survives: [], survivesNot: ['unknown id type'] };
  }
}
