// Animatable Roblox instance properties — a port of Moon Animator 2's Libraries/ItemTable.module.lua.
//
// Moon animates arbitrary properties on live Studio instances. Cadence is a standalone app with
// no Roblox runtime, so the same capability splits in two here:
//   * AUTHORING — keyframe any property in this registry against a named target instance.
//   * DELIVERY  — buildPropertyScriptLua() bakes those tracks into a self-contained Luau script
//                 that reproduces the animation in Studio, alongside the KeyframeSequence export.
// Anything Cadence can render itself (a rig part's Transparency/Color) is also previewed live.
//
// A registry entry is `{ prop, type, inc?, def?, enum? }`; a bare string in a class's list means
// "inherit every property of that class", exactly like Moon's own inheritance pass.

// ---------------------------------------------------------------- value types
// Moon's ItemTable.PropertyTypes: which tween function each value type uses.
// 'discrete' holds the previous value until the next key (Moon's TweenFunctions.Discrete) —
// correct for anything that cannot be meaningfully interpolated.
export const VALUE_TYPES = {
  number: { tween: 'number', default: 0 },
  string: { tween: 'discrete', default: '' },
  boolean: { tween: 'discrete', default: false },
  Instance: { tween: 'discrete', default: '' },   // stored as a path string
  EnumItem: { tween: 'discrete', default: '' },
  CFrame: { tween: 'cframe', default: null },
  Color3: { tween: 'color3', default: [1, 1, 1] },
  Vector2: { tween: 'vector', default: [0, 0] },
  Vector3: { tween: 'vector', default: [0, 0, 0] },
  NumberRange: { tween: 'range', default: [0, 0] },
  // Sequences interpolate only their first keypoint, matching Moon's ColorSeqLerp/NumberSeqLerp.
  ColorSequence: { tween: 'color3', default: [1, 1, 1] },
  NumberSequence: { tween: 'number', default: 0 },
};

export function tweenOf(type) { return VALUE_TYPES[type]?.tween || 'discrete'; }
export function defaultValueFor(type) {
  const d = VALUE_TYPES[type]?.default;
  return Array.isArray(d) ? d.slice() : d;
}
export function isDiscrete(type) { return tweenOf(type) === 'discrete'; }

// ---------------------------------------------------------------- the registry
// Transcribed from Moon's ItemTable.Items. Bare strings are inherited classes, flattened below.
const RAW = {
  Workspace: [['GlobalWind', 'Vector3'], ['AirDensity', 'number'], ['Gravity', 'number']],

  Terrain: [
    ['WaterColor', 'Color3', { def: true }], ['WaterTransparency', 'number', { inc: 0.1, def: true }],
    ['WaterReflectance', 'number', { inc: 0.1 }], ['WaterWaveSize', 'number', { inc: 0.1 }],
    ['WaterWaveSpeed', 'number'],
    ...['Asphalt', 'Basalt', 'Brick', 'Cobblestone', 'Concrete', 'CrackedLava', 'Glacier', 'Grass',
      'Ground', 'Ice', 'LeafyGrass', 'Limestone', 'Mud', 'Pavement', 'Rock', 'Salt', 'Sand',
      'Sandstone', 'Slate', 'Snow', 'WoodPlanks'].map((m) => [`MC_${m}`, 'Color3']),
  ],

  Camera: [
    ['FieldOfView', 'number', { def: true }], ['CFrame', 'CFrame', { def: true }],
    ['AttachToPart', 'Instance'], ['LookAtPart', 'Instance'],
  ],

  BlockMesh: [['Scale', 'Vector3', { def: true }], ['Offset', 'Vector3', { def: true }], ['VertexColor', 'Vector3']],
  SpecialMesh: [
    ['Scale', 'Vector3', { def: true }], ['Offset', 'Vector3', { def: true }], ['VertexColor', 'Vector3'],
    ['MeshType', 'EnumItem'], ['MeshId', 'string'], ['TextureId', 'string'],
  ],

  Humanoid: [
    ['PlayAnimation', 'Instance', { def: true }], ['MoveTo', 'Vector3', { def: true }], ['Jump', 'boolean', { def: true }],
    ['EquipTool', 'Instance'], ['Sit', 'boolean'], ['UnequipTools', 'boolean'], ['AddAccessory', 'Instance'],
    ['RemoveAccessories', 'boolean'], ['Health', 'number'], ['MaxHealth', 'number'], ['HipHeight', 'number'],
    ['MaxSlopeAngle', 'number'], ['WalkSpeed', 'number'], ['AutoRotate', 'boolean'], ['PlatformStand', 'boolean'],
    ['Move', 'Vector3'], ['WalkToPart', 'Instance'], ['TakeDamage', 'number'], ['PlayEmote', 'string'],
    ['ChangeState', 'EnumItem', { enum: 'HumanoidStateType' }], ['AutomaticScalingEnabled', 'boolean'],
    ['AutoJumpEnabled', 'boolean'], ['JumpPower', 'number'], ['UseJumpPower', 'boolean'], ['CameraOffset', 'Vector3'],
    ['DisplayDistanceType', 'EnumItem', { enum: 'HumanoidDisplayDistanceType' }], ['DisplayName', 'string'],
    ['HealthDisplayDistance', 'number'], ['HealthDisplayType', 'EnumItem', { enum: 'HumanoidHealthDisplayType' }],
    ['NameDisplayDistance', 'number'], ['NameOcclusion', 'EnumItem'],
  ],

  // Roblox's 50 FACS controls — all plain 0..1 numbers.
  FaceControls: ['ChinRaiser', 'ChinRaiserUpperLip', 'Corrugator', 'EyesLookDown', 'EyesLookLeft',
    'EyesLookRight', 'EyesLookUp', 'FlatPucker', 'Funneler', 'JawDrop', 'JawLeft', 'JawRight',
    'LeftBrowLowerer', 'LeftCheekPuff', 'LeftCheekRaiser', 'LeftDimpler', 'LeftEyeClosed',
    'LeftEyeUpperLidRaiser', 'LeftInnerBrowRaiser', 'LeftLipCornerDown', 'LeftLipCornerPuller',
    'LeftLipStretcher', 'LeftLowerLipDepressor', 'LeftNoseWrinkler', 'LeftOuterBrowRaiser',
    'LeftUpperLipRaiser', 'LipPresser', 'LipsTogether', 'LowerLipSuck', 'MouthLeft', 'MouthRight',
    'Pucker', 'RightBrowLowerer', 'RightCheekPuff', 'RightCheekRaiser', 'RightDimpler',
    'RightEyeClosed', 'RightEyeUpperLidRaiser', 'RightInnerBrowRaiser', 'RightLipCornerDown',
    'RightLipCornerPuller', 'RightLipStretcher', 'RightLowerLipDepressor', 'RightNoseWrinkler',
    'RightOuterBrowRaiser', 'RightUpperLipRaiser', 'TongueDown', 'TongueOut', 'TongueUp',
    'UpperLipSuck'].map((n) => [n, 'number', { inc: 0.1 }]),

  Sound: [
    ['PlayOnce', 'boolean', { def: true }], ['Play', 'boolean'], ['Stop', 'boolean'],
    ['SetTime', 'number', { inc: 0.1 }], ['Pause', 'boolean'], ['Resume', 'boolean'],
    ['Volume', 'number', { inc: 0.1 }], ['PlaybackSpeed', 'number', { inc: 0.1 }], ['SoundId', 'string'],
    ['Looped', 'boolean'], ['RollOffMaxDistance', 'number'], ['RollOffMinDistance', 'number'],
    ['RollOffMode', 'EnumItem'], ['SoundGroup', 'Instance'], ['PlayOnRemove', 'boolean'],
  ],
  SoundGroup: [['Volume', 'number', { inc: 0.1 }]],
  SoundService: [
    ['AmbientReverb', 'EnumItem', { enum: 'ReverbType' }], ['DistanceFactor', 'number'],
    ['DopplerScale', 'number', { inc: 0.1 }], ['RolloffScale', 'number', { inc: 0.1 }],
  ],

  Script: [['Disabled', 'boolean']],
  LocalScript: [['Disabled', 'boolean']],

  Decal: [
    ['Transparency', 'number', { inc: 0.05 }], ['Color3', 'Color3'], ['Texture', 'string'],
    ['Face', 'EnumItem', { enum: 'NormalId' }],
  ],
  Texture: ['Decal',
    ['OffsetStudsU', 'number', { inc: 0.5 }], ['OffsetStudsV', 'number', { inc: 0.5 }],
    ['StudsPerTileU', 'number', { inc: 0.5 }], ['StudsPerTileV', 'number', { inc: 0.5 }],
  ],

  BasePart: [
    ['CFrame', 'CFrame'], ['Size', 'Vector3'], ['ApplyTexture', 'string'], ['ApplyMesh', 'Instance'],
    ['Color', 'Color3'], ['Transparency', 'number', { inc: 0.05 }], ['Reflectance', 'number', { inc: 0.05 }],
    ['Material', 'EnumItem'], ['Anchored', 'boolean'], ['CastShadow', 'boolean'],
  ],
  Model: [
    ['CFrame', 'CFrame'], ['Scale', 'number', { inc: 0.05 }], ['Transparency', 'number', { inc: 0.05 }],
    ['Color', 'Color3'], ['Reflectance', 'number', { inc: 0.05 }],
  ],
  Shirt: [['Color3', 'Color3'], ['ShirtTemplate', 'string']],
  Pants: [['Color3', 'Color3'], ['PantsTemplate', 'string']],

  Frame: [
    ['BackgroundTransparency', 'number', { inc: 0.05, def: true }], ['BackgroundColor3', 'Color3', { def: true }],
    ['Visible', 'boolean'], ['Rotation', 'number'], ['BorderColor3', 'Color3'], ['BorderSizePixel', 'number'],
    ['AnchorPoint', 'Vector2'], ['ClipsDescendants', 'boolean'], ['LayoutOrder', 'number'],
  ],
  TextLabel: [
    ['Text', 'string', { def: true }], ['MaxVisibleGraphemes', 'number', { def: true }], ['TextColor3', 'Color3'],
    ['TextStrokeColor3', 'Color3'], ['Font', 'EnumItem'], ['TextSize', 'number'],
    ['TextTransparency', 'number', { inc: 0.05 }], ['TextStrokeTransparency', 'number', { inc: 0.05 }],
    ['TextXAlignment', 'EnumItem'], ['TextYAlignment', 'EnumItem'], 'Frame',
  ],
  ImageLabel: [
    ['ImageTransparency', 'number', { inc: 0.05, def: true }], ['ImageColor3', 'Color3', { def: true }], 'Frame',
  ],

  NumberValue: [['Value', 'number']],
  StringValue: [['Value', 'string']],
  ObjectValue: [['Value', 'Instance']],
  BoolValue: [['Value', 'boolean']],
  Vector3Value: [['Value', 'Vector3']],

  Lighting: [
    ['ClockTime', 'number', { inc: 0.25, def: true }], ['Brightness', 'number', { inc: 0.05, def: true }],
    ['Ambient', 'Color3', { def: true }], ['OutdoorAmbient', 'Color3'],
    ['ExposureCompensation', 'number', { inc: 0.05 }], ['FogEnd', 'number', { inc: 10 }],
    ['FogStart', 'number', { inc: 10 }], ['FogColor', 'Color3'], ['GeographicLatitude', 'number', { inc: 0.5 }],
    ['ColorShift_Bottom', 'Color3'], ['ColorShift_Top', 'Color3'],
    ['EnvironmentDiffuseScale', 'number', { inc: 0.05 }], ['EnvironmentSpecularScale', 'number', { inc: 0.05 }],
    ['ShadowSoftness', 'number', { inc: 0.05 }], ['GlobalShadows', 'boolean'],
  ],
  Sky: [
    ['MoonAngularSize', 'number'], ['SunAngularSize', 'number'], ['StarCount', 'number'],
    ['CelestialBodiesShown', 'boolean'], ['SunTextureId', 'string'], ['MoonTextureId', 'string'],
    ['SkyboxBk', 'string'], ['SkyboxDn', 'string'], ['SkyboxFt', 'string'], ['SkyboxLf', 'string'],
    ['SkyboxRt', 'string'], ['SkyboxUp', 'string'],
  ],
  Atmosphere: [
    ['Color', 'Color3', { def: true }], ['Density', 'number', { inc: 0.05, def: true }],
    ['Offset', 'number', { inc: 0.05 }], ['Haze', 'number', { inc: 0.1 }], ['Decay', 'Color3'],
    ['Glare', 'number', { inc: 0.1 }],
  ],
  Clouds: [
    ['Cover', 'number', { inc: 0.05, def: true }], ['Density', 'number', { inc: 0.05, def: true }],
    ['Color', 'Color3'], ['Enabled', 'boolean'],
  ],

  PostEffect: [['Enabled', 'boolean', { def: true }]],
  DepthOfFieldEffect: ['PostEffect',
    ['FocusDistance', 'number', { inc: 0.1, def: true }], ['InFocusRadius', 'number', { inc: 0.1, def: true }],
    ['FarIntensity', 'number', { inc: 0.05 }], ['NearIntensity', 'number', { inc: 0.05 }],
  ],
  BloomEffect: ['PostEffect', ['Intensity', 'number', { inc: 0.05, def: true }], ['Size', 'number', { def: true }], ['Threshold', 'number']],
  BlurEffect: ['PostEffect', ['Size', 'number', { def: true }]],
  ColorCorrectionEffect: ['PostEffect',
    ['TintColor', 'Color3', { def: true }], ['Brightness', 'number', { inc: 0.05, def: true }],
    ['Contrast', 'number', { inc: 0.05, def: true }], ['Saturation', 'number', { inc: 0.05, def: true }],
  ],
  SunRaysEffect: ['PostEffect', ['Intensity', 'number', { inc: 0.05, def: true }], ['Spread', 'number', { inc: 0.05, def: true }]],

  Light: [['Enabled', 'boolean', { def: true }], ['Brightness', 'number', { inc: 0.5, def: true }], ['Color', 'Color3', { def: true }], ['Shadows', 'boolean']],
  PointLight: ['Light', ['Range', 'number', { inc: 0.5 }]],
  SpotLight: ['Light', ['Range', 'number', { inc: 0.5 }], ['Angle', 'number'], ['Face', 'EnumItem', { enum: 'NormalId' }]],
  SurfaceLight: ['Light', ['Range', 'number', { inc: 0.5 }], ['Angle', 'number'], ['Face', 'EnumItem', { enum: 'NormalId' }]],

  Motor6D: [['Enabled', 'boolean']],
  Weld: [['Enabled', 'boolean']],
  Attachment: [['CFrame', 'CFrame']],
  IKControl: [
    ['ChainRoot', 'Instance'], ['Enabled', 'boolean'], ['EndEffector', 'Instance'],
    ['EndEffectorOffset', 'CFrame'], ['Offset', 'CFrame'], ['Pole', 'Instance'], ['Priority', 'number'],
    ['SmoothTime', 'number'], ['Target', 'Instance'], ['Type', 'EnumItem', { enum: 'IKControlType' }], ['Weight', 'number'],
  ],

  Constraint: [['Enabled', 'boolean'], ['Attachment0', 'Instance'], ['Attachment1', 'Instance'], ['Visible', 'boolean']],
  LinearVelocity: ['Constraint',
    ['ForceLimitMode', 'EnumItem'], ['ForceLimitsEnabled', 'boolean'], ['LineDirection', 'Vector3'],
    ['LineVelocity', 'number'], ['MaxAxesForce', 'Vector3'], ['MaxForce', 'number'],
    ['MaxPlanarAxesForce', 'Vector2'], ['PlaneVelocity', 'Vector2'], ['PrimaryTangentAxis', 'Vector3'],
    ['RelativeTo', 'EnumItem', { enum: 'ActuatorRelativeTo' }], ['SecondaryTangentAxis', 'Vector3'],
    ['VectorVelocity', 'Vector3'], ['VelocityConstraintMode', 'EnumItem'],
  ],
  AlignOrientation: ['Constraint',
    ['PrimaryAxisOnly', 'boolean'], ['ReactionTorqueEnabled', 'boolean'], ['RigidityEnabled', 'boolean'],
    ['AlignType', 'EnumItem'], ['MaxAngularVelocity', 'number'], ['MaxTorque', 'number'], ['Responsiveness', 'number'],
  ],
  AlignPosition: ['Constraint',
    ['ApplyAtCenterOfMass', 'boolean'], ['ReactionForceEnabled', 'boolean'], ['RigidityEnabled', 'boolean'],
    ['MaxForce', 'number'], ['MaxVelocity', 'number'], ['Responsiveness', 'number'],
  ],
  AngularVelocity: ['Constraint',
    ['ReactionTorqueEnabled', 'boolean'], ['RelativeTo', 'EnumItem', { enum: 'ActuatorRelativeTo' }],
    ['MaxTorque', 'number'], ['AngularVelocity', 'Vector3'],
  ],
  BallSocketConstraint: ['Constraint',
    ['LimitsEnabled', 'boolean'], ['TwistLimitsEnabled', 'boolean'], ['MaxFrictionTorque', 'number'],
    ['Radius', 'number'], ['Restitution', 'number'], ['TwistLowerAngle', 'number'], ['TwistUpperAngle', 'number'], ['UpperAngle', 'number'],
  ],
  HingeConstraint: ['Constraint',
    ['LimitsEnabled', 'boolean'], ['ActuatorType', 'EnumItem'], ['LowerAngle', 'number'],
    ['MotorMaxAcceleration', 'number'], ['MotorMaxTorque', 'number'], ['Radius', 'number'],
    ['Restitution', 'number'], ['ServoMaxTorque', 'number'], ['TargetAngle', 'number'],
    ['UpperAngle', 'number'], ['AngularSpeed', 'number'], ['AngularVelocity', 'number'], ['CurrentAngle', 'number'],
  ],
  LineForce: ['Constraint', ['ApplyAtCenterOfMass', 'boolean'], ['InverseSquareLaw', 'boolean'], ['ReactionForceEnabled', 'boolean'], ['Magnitude', 'number'], ['MaxForce', 'number']],
  RodConstraint: ['Constraint', ['CurrentDistance', 'number'], ['Length', 'number'], ['Thickness', 'number']],
  RopeConstraint: ['Constraint', ['CurrentDistance', 'number'], ['Length', 'number'], ['Restitution', 'number'], ['Thickness', 'number']],
  SlidingBallConstraint: ['Constraint',
    ['LimitsEnabled', 'boolean'], ['ActuatorType', 'EnumItem'], ['CurrentPosition', 'number'],
    ['LowerLimit', 'number'], ['MotorMaxAcceleration', 'number'], ['MotorMaxForce', 'number'],
    ['Restitution', 'number'], ['ServoMaxForce', 'number'], ['Size', 'number'], ['Speed', 'number'],
    ['TargetPosition', 'number'], ['UpperLimit', 'number'], ['Velocity', 'number'],
  ],
  SpringConstraint: ['Constraint',
    ['LimitsEnabled', 'boolean'], ['Coils', 'number'], ['CurrentLength', 'number'], ['Damping', 'number'],
    ['FreeLength', 'number'], ['MaxForce', 'number'], ['MaxLength', 'number'], ['MinLength', 'number'],
    ['Radius', 'number'], ['Stiffness', 'number'], ['Thickness', 'number'],
  ],
  Torque: ['Constraint', ['RelativeTo', 'EnumItem', { enum: 'ActuatorRelativeTo' }], ['Torque', 'Vector3']],
  VectorForce: ['Constraint', ['ApplyAtCenterOfMass', 'boolean'], ['RelativeTo', 'EnumItem', { enum: 'ActuatorRelativeTo' }], ['Force', 'Vector3']],
  WeldConstraint: ['Constraint', ['Enabled', 'boolean'], ['Part0', 'Instance'], ['Part1', 'Instance']],

  Highlight: [
    ['Enabled', 'boolean', { def: true }], ['FillColor', 'Color3', { def: true }],
    ['FillTransparency', 'number', { inc: 0.05, def: true }], ['OutlineColor', 'Color3'],
    ['OutlineTransparency', 'number', { inc: 0.05 }], ['Adornee', 'Instance'],
    ['DepthMode', 'EnumItem', { enum: 'HighlightDepthMode' }],
  ],

  ParticleEmitter: [
    ['Emit', 'number', { def: true }], ['Enabled', 'boolean', { def: true }], ['Size', 'NumberSequence', { def: true }],
    ['Color', 'ColorSequence', { def: true }], ['Transparency', 'NumberSequence', { def: true }], ['Clear', 'boolean'],
    ['Speed', 'NumberRange'], ['Squash', 'NumberSequence'],
    ['Shape', 'EnumItem', { enum: 'ParticleEmitterShape' }], ['ShapeInOut', 'EnumItem', { enum: 'ParticleEmitterShapeInOut' }],
    ['ShapeStyle', 'EnumItem', { enum: 'ParticleEmitterShapeStyle' }], ['TimeScale', 'number', { inc: 0.1 }],
    ['Rate', 'number'], ['Drag', 'number', { inc: 0.1 }], ['Lifetime', 'NumberRange'], ['Rotation', 'NumberRange'],
    ['RotSpeed', 'NumberRange'], ['LightEmission', 'number', { inc: 0.05 }], ['LightInfluence', 'number', { inc: 0.05 }],
    ['Texture', 'string'], ['EmissionDirection', 'EnumItem', { enum: 'NormalId' }], ['SpreadAngle', 'Vector2'],
    ['Acceleration', 'Vector3'], ['VelocityInheritance', 'number', { inc: 0.05 }], ['ZOffset', 'number'],
    ['LockedToPart', 'boolean'],
  ],
  Trail: [
    ['Enabled', 'boolean', { def: true }], ['Color', 'ColorSequence', { def: true }],
    ['Transparency', 'NumberSequence', { def: true }], ['WidthScale', 'NumberSequence'],
    ['LightEmission', 'number', { inc: 0.05 }], ['LightInfluence', 'number', { inc: 0.05 }],
    ['TextureLength', 'number'], ['Lifetime', 'number'], ['MaxLength', 'number'], ['MinLength', 'number'],
    ['Attachment0', 'Instance'], ['Attachment1', 'Instance'], ['Texture', 'string'],
    ['TextureMode', 'EnumItem'], ['FaceCamera', 'boolean'],
  ],
  Beam: [
    ['Enabled', 'boolean', { def: true }], ['Color', 'ColorSequence', { def: true }],
    ['Transparency', 'NumberSequence', { def: true }], ['Width0', 'number', { inc: 0.5 }], ['Width1', 'number', { inc: 0.5 }],
    ['TextureSpeed', 'number', { inc: 0.5 }], ['TextureLength', 'number', { inc: 0.5 }],
    ['CurveSize0', 'number', { inc: 0.5 }], ['CurveSize1', 'number', { inc: 0.5 }],
    ['LightEmission', 'number', { inc: 0.05 }], ['LightInfluence', 'number', { inc: 0.05 }], ['Segments', 'number'],
    ['Attachment0', 'Instance'], ['Attachment1', 'Instance'], ['Texture', 'string'],
    ['TextureMode', 'EnumItem'], ['FaceCamera', 'boolean'], ['ZOffset', 'number'],
  ],
  Fire: [['Enabled', 'boolean', { def: true }], ['Color', 'Color3', { def: true }], ['SecondaryColor', 'Color3', { def: true }], ['Size', 'number', { def: true }], ['Heat', 'number']],
  ForceField: [['Visible', 'boolean']],
  Sparkles: [['Enabled', 'boolean', { def: true }], ['SparkleColor', 'Color3', { def: true }]],
  Smoke: [['Enabled', 'boolean', { def: true }], ['Color', 'Color3', { def: true }], ['Size', 'number', { def: true }], ['Opacity', 'number', { inc: 0.05, def: true }], ['RiseVelocity', 'number']],
};

// Flatten inherited classes (a bare string entry) — Moon does the same with a repeat-until-stable
// pass, which handles a class inheriting from one that itself inherits.
function flatten() {
  const out = {};
  const resolve = (name, seen = new Set()) => {
    if (out[name]) return out[name];
    if (seen.has(name)) return []; // guards a malformed cycle rather than hanging
    seen.add(name);
    const list = RAW[name];
    if (!list) return [];
    const props = [];
    const taken = new Set();
    const push = (p) => { if (!taken.has(p.prop)) { taken.add(p.prop); props.push(p); } };
    for (const entry of list) {
      if (typeof entry === 'string') { for (const p of resolve(entry, seen)) push(p); continue; }
      const [prop, type, opts = {}] = entry;
      push({ prop, type, inc: opts.inc ?? (type === 'number' ? 1 : undefined), def: !!opts.def, enum: opts.enum });
    }
    out[name] = props;
    return props;
  };
  for (const name of Object.keys(RAW)) resolve(name);
  return out;
}

export const CLASS_PROPERTIES = flatten();
export const CLASS_NAMES = Object.keys(CLASS_PROPERTIES).sort();

export function propertiesFor(className) { return CLASS_PROPERTIES[className] || []; }
export function propertyDef(className, prop) { return propertiesFor(className).find((p) => p.prop === prop) || null; }

// Moon's `def = true` marks the properties a freshly-added item gets tracks for straight away,
// so the common case needs no picking through the full list.
export function defaultPropertiesFor(className) {
  return propertiesFor(className).filter((p) => p.def).map((p) => p.prop);
}

// ---------------------------------------------------------------- tweening
// Mirrors Moon's ItemTable.TweenFunctions. `alpha` has already had the key's easing applied.
export function tweenValue(type, a, b, alpha) {
  if (a === undefined || a === null) return b;
  if (b === undefined || b === null) return a;
  switch (tweenOf(type)) {
    case 'discrete':
      // Moon's Discrete: hold the earlier value for the whole segment, snap at the next key.
      return alpha >= 1 ? b : a;
    case 'number':
      return a + (b - a) * alpha;
    case 'color3':
    case 'vector':
    case 'range':
      if (!Array.isArray(a) || !Array.isArray(b)) return alpha >= 1 ? b : a;
      return a.map((v, i) => v + ((b[i] ?? v) - v) * alpha);
    case 'cframe':
      return null; // CFrame tracks go through state.js's evalTrackCF / CF.lerp, not here
    default:
      return alpha >= 1 ? b : a;
  }
}

// ---------------------------------------------------------------- Luau emission
// Property tracks have no slot in a Roblox KeyframeSequence, so delivery is a generated script.
// Values are emitted as Luau literals of the right constructor for their declared type.
export function luaValue(type, v) {
  switch (type) {
    case 'number': return String(Number(v) || 0);
    case 'boolean': return v ? 'true' : 'false';
    case 'string': return luaString(String(v ?? ''));
    case 'Instance': return v ? `resolve(${luaString(String(v))})` : 'nil';
    case 'EnumItem': return v ? `Enum.${String(v)}` : 'nil';
    case 'Color3': return `Color3.new(${num(v?.[0])}, ${num(v?.[1])}, ${num(v?.[2])})`;
    case 'ColorSequence': return `ColorSequence.new(Color3.new(${num(v?.[0])}, ${num(v?.[1])}, ${num(v?.[2])}))`;
    case 'Vector2': return `Vector2.new(${num(v?.[0])}, ${num(v?.[1])})`;
    case 'Vector3': return `Vector3.new(${num(v?.[0])}, ${num(v?.[1])}, ${num(v?.[2])})`;
    case 'NumberRange': return `NumberRange.new(${num(v?.[0])}, ${num(v?.[1] ?? v?.[0])})`;
    case 'NumberSequence': return `NumberSequence.new(${num(v)})`;
    case 'CFrame': return Array.isArray(v) ? `CFrame.new(${v.map(num).join(', ')})` : 'CFrame.identity';
    default: return 'nil';
  }
}
function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? String(x) : '0';
}
export function luaString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

// ---------------------------------------------------------------- action tracks
// Moon's Classes/LayerSystemItem/Action/* — one-shot calls fired when playback crosses the key,
// rather than values interpolated over time. `arg` describes what the single keyframe value means.
export const ACTIONS = {
  'Sound.Play': { className: 'Sound', label: 'Play sound', arg: null, lua: (t) => `${t}:Play()` },
  'Sound.Stop': { className: 'Sound', label: 'Stop sound', arg: null, lua: (t) => `${t}:Stop()` },
  'Sound.Pause': { className: 'Sound', label: 'Pause sound', arg: null, lua: (t) => `${t}:Pause()` },
  'Sound.Resume': { className: 'Sound', label: 'Resume sound', arg: null, lua: (t) => `${t}:Resume()` },
  'Sound.PlayOnce': { className: 'Sound', label: 'Play sound once', arg: null, lua: (t) => `${t}.TimePosition = 0 ${t}:Play()` },
  'Sound.SetTime': { className: 'Sound', label: 'Set sound time', arg: 'number', lua: (t, v) => `${t}.TimePosition = ${v}` },
  'ParticleEmitter.Emit': { className: 'ParticleEmitter', label: 'Emit particles', arg: 'number', lua: (t, v) => `${t}:Emit(${v})` },
  'ParticleEmitter.Clear': { className: 'ParticleEmitter', label: 'Clear particles', arg: null, lua: (t) => `${t}:Clear()` },
  'Humanoid.MoveTo': { className: 'Humanoid', label: 'Move to', arg: 'Vector3', lua: (t, v) => `${t}:MoveTo(${v})` },
  'Humanoid.Move': { className: 'Humanoid', label: 'Move', arg: 'Vector3', lua: (t, v) => `${t}:Move(${v}, false)` },
  'Humanoid.Jump': { className: 'Humanoid', label: 'Jump', arg: null, lua: (t) => `${t}.Jump = true` },
  'Humanoid.Sit': { className: 'Humanoid', label: 'Sit', arg: 'boolean', lua: (t, v) => `${t}.Sit = ${v}` },
  'Humanoid.TakeDamage': { className: 'Humanoid', label: 'Take damage', arg: 'number', lua: (t, v) => `${t}:TakeDamage(${v})` },
  'Humanoid.ChangeState': { className: 'Humanoid', label: 'Change state', arg: 'EnumItem', lua: (t, v) => `${t}:ChangeState(${v})` },
  'Humanoid.EquipTool': { className: 'Humanoid', label: 'Equip tool', arg: 'Instance', lua: (t, v) => `${t}:EquipTool(${v})` },
  'Humanoid.UnequipTools': { className: 'Humanoid', label: 'Unequip tools', arg: null, lua: (t) => `${t}:UnequipTools()` },
  'Humanoid.AddAccessory': { className: 'Humanoid', label: 'Add accessory', arg: 'Instance', lua: (t, v) => `${t}:AddAccessory(${v})` },
  'Humanoid.RemoveAccessories': { className: 'Humanoid', label: 'Remove accessories', arg: null, lua: (t) => `${t}:RemoveAccessories()` },
  'Humanoid.PlayEmote': { className: 'Humanoid', label: 'Play emote', arg: 'string', lua: (t, v) => `${t}:PlayEmote(${v})` },
  'Humanoid.PlayAnimation': { className: 'Humanoid', label: 'Play animation', arg: 'Instance', lua: (t, v) => `local _a = ${t}:LoadAnimation(${v}) if _a then _a:Play() end` },
  'BasePart.ApplyMesh': { className: 'BasePart', label: 'Apply mesh', arg: 'Instance', lua: (t, v) => `local _m = ${v} if _m then _m:Clone().Parent = ${t} end` },
  'BasePart.ApplyTexture': { className: 'BasePart', label: 'Apply texture', arg: 'string', lua: (t, v) => `local _d = Instance.new("Decal") _d.Texture = ${v} _d.Parent = ${t}` },
};
export const ACTION_KEYS = Object.keys(ACTIONS);
export function actionsFor(className) {
  return ACTION_KEYS.filter((k) => ACTIONS[k].className === className);
}
