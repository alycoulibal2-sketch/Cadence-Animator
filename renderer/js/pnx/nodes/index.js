// The node catalogue. Importing this module registers every node type exactly once.
//
// Order matters only in that a module must not be imported twice (registerNode() rejects a
// duplicate id, deliberately — a double import is a real bug and silently allowing it would let two
// definitions of the same node coexist). Everything here registers by side effect; there is nothing
// to name-import, which is why this file has no re-exports.
//
// The import order below follows the spec's Part 77 phase order, so reading it top-to-bottom is
// also a statement of what the engine can currently do:
//
//   Phase 2  math, vector, transform, colour, curve, time, logic, random
//   Phase 3  noise, patterns, SDF, attributes, fields
//   Phase 4+ geometry, particles, renderers, ... (not yet present — no placeholder imports)

// --- Phase 2: values and pure operations
import './math.js';
import './vector.js';
import './transform.js';
import './color.js';
import './curve.js';
import './time.js';
import './logic.js';
import './random.js';

// --- Phase 3: procedural sources and the field algebra
import './noise.js';
import './fields.js';
import './pattern.js';
import './sdf.js';
import './attribute.js';

// --- Phase 4: geometry, curves, sampling, instancing
import './geometry.js';
import './sampling.js';

// --- Phase 5: particles, forces, the staged solver, collisions
import './particles.js';

// --- Phase 6: materials, renderers, lights, trails/ribbons/beams
import './render.js';

// --- always available: observability and layout
import './debug.js';
