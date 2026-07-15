--[[
  Cadence Bridge — companion Studio plugin for Cadence Animator.

  This plugin does NOT hold animation state. Every pose, keyframe and curve lives
  in the Cadence desktop app (which autosaves after every change). This plugin only:
    1. Reads rigs/animations out of this place and hands them to Cadence.
    2. Writes finished animations back in as a KeyframeSequence under <rig>.AnimSaves,
       which is the exact same folder Roblox's own Animation Editor reads from.

  Because there is no in-Studio editor UI to desync, the classic Moon Animator bug where
  closing Studio before closing the animator widget wipes the timeline cannot happen here —
  there is nothing transient to lose. Studio's own save/autosave already protects everything
  this plugin creates, the moment it's created.
]]

local HttpService = game:GetService("HttpService")
local InsertService = game:GetService("InsertService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local KeyframeSequenceProvider = game:GetService("KeyframeSequenceProvider")
local Players = game:GetService("Players")

local BRIDGE_PORT = 35747
local BASE_URL = "http://127.0.0.1:" .. BRIDGE_PORT

-- ==================================================================== helpers

local function cfComponents(cf)
	local x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22 = cf:GetComponents()
	return { x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22 }
end

local function cfFromComponents(t)
	return CFrame.new(t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10], t[11], t[12])
end

local function colorHex(c)
	return string.format("#%02X%02X%02X", math.floor(c.R * 255 + 0.5), math.floor(c.G * 255 + 0.5), math.floor(c.B * 255 + 0.5))
end

local function getStagingFolder()
	local f = workspace:FindFirstChild("CadenceImports")
	if not f then
		f = Instance.new("Folder")
		f.Name = "CadenceImports"
		f.Parent = workspace
	end
	return f
end

-- Every rig we touch gets a permanent, invisible identity tag. Exports and syncs are matched
-- against THIS id, never against Instance.Name — two rigs named "Zombie" can no longer cross-wire
-- each other's animation data the way they could in Moon Animator.
local function ensureCadenceId(model)
	local id = model:GetAttribute("CadenceId")
	if not id then
		id = HttpService:GenerateGUID(false)
		model:SetAttribute("CadenceId", id)
	end
	return id
end

local function findRigByCadenceId(id)
	if not id then return nil end
	for _, d in ipairs(workspace:GetDescendants()) do
		if d:IsA("Model") and d:GetAttribute("CadenceId") == id then
			return d
		end
	end
	return nil
end

local function findRigByName(name)
	local candidates = {}
	for _, d in ipairs(workspace:GetDescendants()) do
		if d:IsA("Model") and d.Name == name then
			if d:FindFirstChildOfClass("Humanoid") or d:FindFirstChildWhichIsA("Motor6D", true) then
				table.insert(candidates, d)
			end
		end
	end
	if #candidates == 0 then
		return nil, "No rig named '" .. name .. "' found in Workspace"
	end
	if #candidates > 1 then
		warn(("[Cadence] %d rigs in Workspace are named '%s' — using the first one. Add the rig from Studio again to link it by identity instead of by name."):format(#candidates, name))
	end
	return candidates[1]
end

-- Ensures the well-known engine-blending fallback is on, per Roblox's own guidance for
-- KeyframeSequence-authored animations that fight modern runtime blending (limb twitching in-game).
-- Never overwrites a value the user already set deliberately.
local function ensureLegacyBlendingAttribute()
	if workspace:GetAttribute("RbxLegacyAnimationBlending") == nil then
		workspace:SetAttribute("RbxLegacyAnimationBlending", true)
	end
end

-- ==================================================================== rig serialization

local BASEPART_CLASSES = {
	Part = true, MeshPart = true, WedgePart = true, CornerWedgePart = true,
	TrussPart = true, UnionOperation = true, Seat = true, VehicleSeat = true, SpawnLocation = true,
}
local MOTOR_CLASSES = { Motor6D = true, Motor = true }
local WELD_CLASSES = { Weld = true, ManualWeld = true, Snap = true, ManualGlue = true, Glue = true, WeldConstraint = true }

local SHAPE_NAMES = {
	[Enum.PartType.Ball] = "Ball", [Enum.PartType.Block] = "Block", [Enum.PartType.Cylinder] = "Cylinder",
	[Enum.PartType.Wedge] = "Wedge", [Enum.PartType.CornerWedge] = "CornerWedge",
}
local MESHTYPE_NAMES = {
	[Enum.MeshType.Head] = "Head", [Enum.MeshType.Torso] = "Torso", [Enum.MeshType.Wedge] = "Wedge",
	[Enum.MeshType.Sphere] = "Sphere", [Enum.MeshType.Cylinder] = "Cylinder", [Enum.MeshType.FileMesh] = "FileMesh",
	[Enum.MeshType.Brick] = "Brick", [Enum.MeshType.Prism] = "Prism", [Enum.MeshType.Pyramid] = "Pyramid",
	[Enum.MeshType.ParallelRamp] = "ParallelRamp", [Enum.MeshType.RightAngleRamp] = "RightAngleRamp",
	[Enum.MeshType.CornerWedge] = "CornerWedge",
}

-- Walks EVERY descendant regardless of nesting depth (Model > Folder > Model > Part, etc.) —
-- this is the fix for Moon's "fails past 3 layers of nesting" bug: there is no depth limit here.
local function serializeRig(model, displayName)
	local partList = {}
	local idByPart = {}
	local usedIds = {}

	local function assignId(part)
		local base = part.Name
		local id = base
		local n = 2
		while usedIds[id] do
			id = base .. "#" .. n
			n = n + 1
		end
		usedIds[id] = true
		idByPart[part] = id
	end

	for _, d in ipairs(model:GetDescendants()) do
		if BASEPART_CLASSES[d.ClassName] then
			assignId(d)
			table.insert(partList, d)
		end
	end
	if #partList == 0 then
		error("No parts found in '" .. model.Name .. "'")
	end

	local rootPart = model:FindFirstChild("HumanoidRootPart")
	if not rootPart or not idByPart[rootPart] then
		rootPart = model.PrimaryPart
	end
	if not rootPart or not idByPart[rootPart] then
		local isPart1 = {}
		for _, d in ipairs(model:GetDescendants()) do
			if MOTOR_CLASSES[d.ClassName] and d.Part1 then
				isPart1[d.Part1] = true
			end
		end
		for _, p in ipairs(partList) do
			if not isPart1[p] then
				rootPart = p
				break
			end
		end
	end
	rootPart = rootPart or partList[1]
	local rootCf = rootPart.CFrame

	local parts = {}
	for _, p in ipairs(partList) do
		local rel = rootCf:ToObjectSpace(p.CFrame)
		local entry = {
			id = idByPart[p],
			name = p.Name,
			className = (p.ClassName == "MeshPart") and "MeshPart" or "Part",
			size = { p.Size.X, p.Size.Y, p.Size.Z },
			cf = cfComponents(rel),
			color = colorHex(p.Color),
			transparency = p.Transparency,
			material = p.Material.Name,
			reflectance = p.Reflectance,
		}
		if p:IsA("Part") then
			entry.shape = SHAPE_NAMES[p.Shape] or "Block"
		end
		if p.ClassName == "MeshPart" then
			entry.meshId = p.MeshId
			entry.textureId = p.TextureID
		end
		local sm = p:FindFirstChildWhichIsA("SpecialMesh")
		if sm then
			entry.specialMesh = {
				meshType = MESHTYPE_NAMES[sm.MeshType] or "Brick",
				meshId = sm.MeshId,
				textureId = sm.TextureId,
				scale = { sm.Scale.X, sm.Scale.Y, sm.Scale.Z },
				offset = { sm.Offset.X, sm.Offset.Y, sm.Offset.Z },
			}
		end
		-- Modern UGC heads carry their real texture on a SurfaceAppearance, not MeshPart.TextureID.
		-- Missing this is exactly what causes the "UGC mesh head turns black" bug — so we always capture it.
		local sa = p:FindFirstChildOfClass("SurfaceAppearance")
		if sa then
			entry.surfaceAppearance = {
				colorMap = sa.ColorMap,
				normalMap = sa.NormalMap,
				roughnessMap = sa.RoughnessMap,
				metalnessMap = sa.MetalnessMap,
			}
		end
		-- Every Decal on the part, on whatever face it's actually on — not just the front one.
		-- A part can carry up to six (one per face); Studio builds commonly use more than Front.
		local decals = {}
		for _, c in ipairs(p:GetChildren()) do
			if c:IsA("Decal") and c.Texture ~= "" then
				table.insert(decals, { face = c.Face.Name, texture = c.Texture, transparency = c.Transparency })
			end
		end
		if #decals > 0 then
			entry.decals = decals
		end
		table.insert(parts, entry)
	end

	local joints = {}
	for _, d in ipairs(model:GetDescendants()) do
		if MOTOR_CLASSES[d.ClassName] and d.Part0 and d.Part1 and idByPart[d.Part0] and idByPart[d.Part1] then
			table.insert(joints, {
				name = d.Name,
				part0 = idByPart[d.Part0],
				part1 = idByPart[d.Part1],
				c0 = cfComponents(d.C0),
				c1 = cfComponents(d.C1),
			})
		end
	end
	for _, d in ipairs(model:GetDescendants()) do
		if WELD_CLASSES[d.ClassName] and d.Part0 and d.Part1 and idByPart[d.Part0] and idByPart[d.Part1] then
			local c0, c1
			if d:IsA("WeldConstraint") then
				c0 = d.Part0.CFrame:ToObjectSpace(d.Part1.CFrame)
				c1 = CFrame.new()
			else
				c0, c1 = d.C0, d.C1
			end
			table.insert(joints, {
				name = d.Name, kind = "weld",
				part0 = idByPart[d.Part0], part1 = idByPart[d.Part1],
				c0 = cfComponents(c0), c1 = cfComponents(c1),
			})
		end
	end

	-- Bug-specific sanity check: a HumanoidRootPart that lost its joint plays back frozen in place.
	if rootPart.Name == "HumanoidRootPart" then
		local hasRootJoint = false
		for _, j in ipairs(joints) do
			if j.part0 == idByPart[rootPart] or j.part1 == idByPart[rootPart] then
				hasRootJoint = true
				break
			end
		end
		if not hasRootJoint then
			warn("[Cadence] HumanoidRootPart on '" .. model.Name .. "' has no joint connecting it to the rig — root motion will not work. This rig's RootJoint may already be broken.")
		end
	end

	local rigType = "Custom"
	local hum = model:FindFirstChildOfClass("Humanoid")
	if hum then rigType = hum.RigType.Name end

	return {
		name = displayName or model.Name,
		rigType = rigType,
		rootPart = idByPart[rootPart],
		parts = parts,
		joints = joints,
	}
end

-- ==================================================================== animation <-> KeyframeSequence

local PRIORITY_ENUM = {
	Idle = Enum.AnimationPriority.Idle, Movement = Enum.AnimationPriority.Movement,
	Action = Enum.AnimationPriority.Action, Action2 = Enum.AnimationPriority.Action2,
	Action3 = Enum.AnimationPriority.Action3, Action4 = Enum.AnimationPriority.Action4,
	Core = Enum.AnimationPriority.Core,
}
local PRIORITY_NAME = {}
for k, v in pairs(PRIORITY_ENUM) do PRIORITY_NAME[v] = k end

local STYLE_ENUM = {
	Linear = Enum.PoseEasingStyle.Linear, Constant = Enum.PoseEasingStyle.Constant,
	Elastic = Enum.PoseEasingStyle.Elastic, Cubic = Enum.PoseEasingStyle.Cubic,
	Bounce = Enum.PoseEasingStyle.Bounce,
}
local DIR_ENUM = { In = Enum.PoseEasingDirection.In, Out = Enum.PoseEasingDirection.Out, InOut = Enum.PoseEasingDirection.InOut }

-- Builds real Pose instances nested to match the rig's joint hierarchy — same shape
-- Roblox's own Animation Editor produces, so anything downstream (Import, in-game playback) just works.
local function buildKeyframeSequence(data)
	local ks = Instance.new("KeyframeSequence")
	ks.Name = data.name
	ks.Loop = data.loop and true or false
	ks.Priority = PRIORITY_ENUM[data.priority] or Enum.AnimationPriority.Action

	for _, kf in ipairs(data.keyframes) do
		local keyframe = Instance.new("Keyframe")
		keyframe.Time = kf.time
		keyframe.Name = "Keyframe"

		local posedByPart = {}
		for _, pose in ipairs(kf.poses) do
			posedByPart[pose.part] = pose
		end

		local childrenOf = {}
		local function ensureChain(partName)
			local cur = partName
			while cur and cur ~= data.rootPart do
				local parent = data.parentByPart[cur] or data.rootPart
				childrenOf[parent] = childrenOf[parent] or {}
				childrenOf[parent][cur] = true
				cur = parent
			end
		end
		for _, pose in ipairs(kf.poses) do
			ensureChain(pose.part)
		end

		local function emitPose(partName, parentInstance)
			local pose = posedByPart[partName]
			local poseInst = Instance.new("Pose")
			poseInst.Name = partName
			poseInst.CFrame = pose and cfFromComponents(pose.cf) or CFrame.new()
			poseInst.Weight = pose and pose.weight or 0
			poseInst.EasingStyle = (pose and STYLE_ENUM[pose.es]) or Enum.PoseEasingStyle.Linear
			poseInst.EasingDirection = (pose and DIR_ENUM[pose.ed]) or Enum.PoseEasingDirection.In
			poseInst.Parent = parentInstance
			local kids = childrenOf[partName]
			if kids then
				for child in pairs(kids) do
					emitPose(child, poseInst)
				end
			end
		end
		emitPose(data.rootPart, keyframe)
		keyframe.Parent = ks
	end
	return ks
end

local POSE_STYLE_NAME = { [Enum.PoseEasingStyle.Linear] = "Linear", [Enum.PoseEasingStyle.Constant] = "Constant", [Enum.PoseEasingStyle.Elastic] = "Elastic", [Enum.PoseEasingStyle.Cubic] = "Cubic", [Enum.PoseEasingStyle.Bounce] = "Bounce" }
local POSE_DIR_NAME = { [Enum.PoseEasingDirection.In] = "In", [Enum.PoseEasingDirection.Out] = "Out", [Enum.PoseEasingDirection.InOut] = "InOut" }

local function neutralAnimFromInstance(ks)
	local keyframes = {}
	for _, kfInst in ipairs(ks:GetChildren()) do
		if kfInst:IsA("Keyframe") then
			local poses = {}
			local function walk(node)
				for _, c in ipairs(node:GetChildren()) do
					if c:IsA("Pose") then
						table.insert(poses, {
							part = c.Name,
							cf = cfComponents(c.CFrame),
							weight = c.Weight,
							es = POSE_STYLE_NAME[c.EasingStyle] or "Linear",
							ed = POSE_DIR_NAME[c.EasingDirection] or "In",
						})
						walk(c)
					end
				end
			end
			walk(kfInst)
			table.insert(keyframes, { time = kfInst.Time, poses = poses })
		end
	end
	table.sort(keyframes, function(a, b) return a.time < b.time end)
	return {
		name = ks.Name,
		loop = ks.Loop,
		priority = PRIORITY_NAME[ks.Priority] or "Action",
		keyframes = keyframes,
	}
end

-- ==================================================================== command handlers

local HANDLERS = {}

function HANDLERS.buildAvatar(payload)
	local userId = payload.userId
	assert(userId, "userId required")
	local desc = Players:GetHumanoidDescriptionFromUserId(userId)
	local model = Players:CreateHumanoidModelFromDescription(desc, Enum.HumanoidRigType.R15)
	model.Name = payload.displayName or ("Avatar_" .. tostring(userId))
	for _, part in ipairs(model:GetDescendants()) do
		if part:IsA("BasePart") then
			part.Anchored = true
			part.CanCollide = false
		end
	end
	model.Parent = getStagingFolder()
	local id = ensureCadenceId(model)
	local rig = serializeRig(model, model.Name)
	return { rig = rig, studioId = id }
end

function HANDLERS.getSelectedRig()
	local sel = Selection:Get()
	if #sel == 0 then
		error("Nothing selected in Studio — select a rig's Model in the Explorer first")
	end
	local model = sel[1]
	if not model:IsA("Model") then
		local anc = model:FindFirstAncestorWhichIsA("Model")
		if not anc then
			error("Select a Model (a rig), not a " .. model.ClassName)
		end
		model = anc
	end
	local id = ensureCadenceId(model)
	local rig = serializeRig(model, model.Name)
	return { rig = rig, studioId = id }
end

function HANDLERS.insertAsset(payload)
	local assetId = tostring(payload.assetId):match("%d+")
	assert(assetId, "Could not read an asset id from '" .. tostring(payload.assetId) .. "'")
	local container = InsertService:LoadAsset(tonumber(assetId))
	container.Parent = getStagingFolder()
	for _, part in ipairs(container:GetDescendants()) do
		if part:IsA("BasePart") then
			part.Anchored = true
			part.CanCollide = false
		end
	end
	local id = ensureCadenceId(container)
	local rig = serializeRig(container, container.Name)
	return { rig = rig, studioId = id }
end

function HANDLERS.buildAnimation(payload)
	local data = payload.data
	assert(data and data.keyframes, "Missing animation data")

	local rig = findRigByCadenceId(payload.studioId)
	if not rig then
		rig = findRigByName(payload.rigName)
	end
	if not rig then
		error("Could not find rig '" .. tostring(payload.rigName) .. "' in Workspace — is it still there?")
	end

	ensureLegacyBlendingAttribute()

	local animSaves = rig:FindFirstChild("AnimSaves")
	if not animSaves then
		animSaves = Instance.new("Folder")
		animSaves.Name = "AnimSaves"
		animSaves.Parent = rig
	end

	ChangeHistoryService:SetWaypoint("Before Cadence animation import")
	local existing = animSaves:FindFirstChild(data.name)
	if existing then
		existing:Destroy()
	end
	local ks = buildKeyframeSequence(data)
	ks.Parent = animSaves
	ChangeHistoryService:SetWaypoint("Cadence animation imported: " .. data.name)

	Selection:Set({ ks })

	return {
		path = rig:GetFullName() .. ".AnimSaves." .. data.name,
		publishHint = payload.publish
			and ("'" .. data.name .. "' is ready in " .. rig.Name .. " > AnimSaves. Open the Animation Editor (Avatar tab) on this rig, click Import, choose it, then Export to publish and get an asset ID.")
			or nil,
	}
end

function HANDLERS.getAnimationById(payload)
	local assetId = tostring(payload.assetId):match("%d+")
	assert(assetId, "assetId required")
	local ks = KeyframeSequenceProvider:GetKeyframeSequenceAsync("rbxassetid://" .. assetId)
	local anim = neutralAnimFromInstance(ks)
	ks:Destroy()
	return { anim = anim }
end

function HANDLERS.listAnimSaves()
	local rigs = {}
	for _, model in ipairs(workspace:GetDescendants()) do
		if model:IsA("Model") then
			local animSaves = model:FindFirstChild("AnimSaves")
			if animSaves then
				local anims = {}
				for _, child in ipairs(animSaves:GetChildren()) do
					if child:IsA("KeyframeSequence") then
						table.insert(anims, child.Name)
					end
				end
				if #anims > 0 then
					table.insert(rigs, { name = model.Name, anims = anims })
				end
			end
		end
	end
	return { rigs = rigs }
end

function HANDLERS.getAnimSave(payload)
	local rig
	for _, model in ipairs(workspace:GetDescendants()) do
		if model:IsA("Model") and model.Name == payload.rigName and model:FindFirstChild("AnimSaves") then
			rig = model
			break
		end
	end
	assert(rig, "Rig '" .. tostring(payload.rigName) .. "' not found")
	local ks = rig.AnimSaves:FindFirstChild(payload.animName)
	assert(ks, "Animation '" .. tostring(payload.animName) .. "' not found in " .. payload.rigName .. ".AnimSaves")
	return { anim = neutralAnimFromInstance(ks) }
end

-- ==================================================================== networking

local function post(path, bodyTable)
	return HttpService:RequestAsync({
		Url = BASE_URL .. path,
		Method = "POST",
		Headers = { ["Content-Type"] = "application/json" },
		Body = HttpService:JSONEncode(bodyTable or {}),
	})
end

local function respond(id, ok, data, err)
	pcall(post, "/result", { id = id, ok = ok, data = data, error = err })
end

local function handleCommand(cmd)
	local handler = HANDLERS[cmd.type]
	if not handler then
		respond(cmd.id, false, nil, "Unknown command: " .. tostring(cmd.type))
		return
	end
	local ok, result = pcall(handler, cmd.payload or {})
	if ok then
		respond(cmd.id, true, result)
	else
		respond(cmd.id, false, nil, tostring(result))
	end
end

local running = false
local connected = false
local lastError = nil        -- last reason a connect/poll attempt failed, shown in the status panel
local lastContact = nil      -- os.clock() of the last successful request, for "last seen" display
local setStatus -- forward decl, assigned once the toolbar + status panel exist

local function poll()
	while running do
		local ok, res = pcall(function()
			return HttpService:RequestAsync({ Url = BASE_URL .. "/poll", Method = "GET" })
		end)
		if not running then
			break
		end
		if ok and res.Success then
			lastContact = os.clock()
			if not connected then
				connected = true
				lastError = nil
				setStatus(true)
			end
			local okDecode, body = pcall(HttpService.JSONDecode, HttpService, res.Body)
			if okDecode and body.commands then
				for _, cmd in ipairs(body.commands) do
					task.spawn(handleCommand, cmd)
				end
			end
		else
			if connected then
				connected = false
				lastError = (ok and res and ("HTTP " .. tostring(res.StatusCode))) or "Could not reach the app"
				setStatus(false)
			end
			task.wait(2)
		end
	end
end

local function connect()
	if running then
		return
	end
	running = true
	setStatus(nil) -- "connecting…" state
	local ok, res = pcall(post, "/hello", { placeName = (game.Name ~= "" and game.Name) or "Untitled place" })
	if ok and res.Success then
		connected = true
		lastError = nil
		lastContact = os.clock()
		setStatus(true)
		task.spawn(poll)
	else
		running = false
		connected = false
		lastError = "Could not reach the app on port " .. BRIDGE_PORT
		setStatus(false)
		warn("[Cadence] Could not reach the Cadence Animator app at " .. BASE_URL .. ". Is the app running? Is 'Allow HTTP Requests' enabled in Game Settings > Security?")
	end
end

local function disconnect()
	running = false
	connected = false
	lastError = nil
	setStatus(false)
end

-- ==================================================================== status panel

-- A dockable panel (not just a toolbar tint) so connection state, port, place, and last-contact
-- time are always visible at a glance — previously the only feedback was whether one small
-- toolbar icon looked pressed-in or not, which is why "am I actually connected?" was so hard to
-- answer at a glance that a real, persistently-flapping bridge bug went unnoticed for a while.
local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 260, 280, 230, 230)
local widget = plugin:CreateDockWidgetPluginGui("CadenceBridgeStatus", widgetInfo)
widget.Title = "Cadence Bridge"
widget.Name = "CadenceBridgeStatus"

local root = Instance.new("Frame")
root.Size = UDim2.fromScale(1, 1)
root.BackgroundColor3 = Color3.fromRGB(30, 30, 34)
root.BorderSizePixel = 0
root.Parent = widget

local pad = Instance.new("UIPadding")
pad.PaddingTop = UDim.new(0, 12)
pad.PaddingBottom = UDim.new(0, 12)
pad.PaddingLeft = UDim.new(0, 12)
pad.PaddingRight = UDim.new(0, 12)
pad.Parent = root

local layout = Instance.new("UIListLayout")
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Padding = UDim.new(0, 8)
layout.Parent = root

local function row(order)
	local f = Instance.new("Frame")
	f.Size = UDim2.new(1, 0, 0, 18)
	f.BackgroundTransparency = 1
	f.LayoutOrder = order
	f.Parent = root
	return f
end

-- headline: dot + status text
local headline = row(1)
local dot = Instance.new("Frame")
dot.Size = UDim2.fromOffset(10, 10)
dot.Position = UDim2.fromOffset(0, 4)
dot.BackgroundColor3 = Color3.fromRGB(140, 140, 148)
dot.BorderSizePixel = 0
local dotCorner = Instance.new("UICorner")
dotCorner.CornerRadius = UDim.new(1, 0)
dotCorner.Parent = dot
dot.Parent = headline

local statusText = Instance.new("TextLabel")
statusText.Size = UDim2.new(1, -18, 1, 0)
statusText.Position = UDim2.fromOffset(18, 0)
statusText.BackgroundTransparency = 1
statusText.Font = Enum.Font.GothamBold
statusText.TextSize = 15
statusText.TextXAlignment = Enum.TextXAlignment.Left
statusText.TextColor3 = Color3.fromRGB(230, 230, 235)
statusText.Text = "Disconnected"
statusText.Parent = headline

local function infoRow(order, label)
	local f = row(order)
	local l = Instance.new("TextLabel")
	l.Size = UDim2.fromOffset(90, 18)
	l.BackgroundTransparency = 1
	l.Font = Enum.Font.Gotham
	l.TextSize = 13
	l.TextXAlignment = Enum.TextXAlignment.Left
	l.TextColor3 = Color3.fromRGB(150, 150, 158)
	l.Text = label
	l.Parent = f
	local v = Instance.new("TextLabel")
	v.Size = UDim2.new(1, -90, 1, 0)
	v.Position = UDim2.fromOffset(90, 0)
	v.BackgroundTransparency = 1
	v.Font = Enum.Font.GothamMedium
	v.TextSize = 13
	v.TextXAlignment = Enum.TextXAlignment.Left
	v.TextColor3 = Color3.fromRGB(220, 220, 225)
	v.TextTruncate = Enum.TextTruncate.AtEnd
	v.Text = "—"
	v.Parent = f
	return v
end

local portValue = infoRow(2, "Port")
portValue.Text = tostring(BRIDGE_PORT)
local placeValue = infoRow(3, "Place")
local lastSeenValue = infoRow(4, "Last contact")

local errorText = Instance.new("TextLabel")
errorText.Size = UDim2.new(1, 0, 0, 32)
errorText.LayoutOrder = 5
errorText.BackgroundTransparency = 1
errorText.Font = Enum.Font.Gotham
errorText.TextSize = 12
errorText.TextWrapped = true
errorText.TextXAlignment = Enum.TextXAlignment.Left
errorText.TextYAlignment = Enum.TextYAlignment.Top
errorText.TextColor3 = Color3.fromRGB(242, 104, 107)
errorText.Text = ""
errorText.Visible = false
errorText.Parent = root

local toggleBtn = Instance.new("TextButton")
toggleBtn.Size = UDim2.new(1, 0, 0, 30)
toggleBtn.LayoutOrder = 6
toggleBtn.Font = Enum.Font.GothamBold
toggleBtn.TextSize = 13
toggleBtn.BackgroundColor3 = Color3.fromRGB(90, 100, 235)
toggleBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
toggleBtn.Text = "🔌  Connect"
local btnCorner = Instance.new("UICorner")
btnCorner.CornerRadius = UDim.new(0, 6)
btnCorner.Parent = toggleBtn
toggleBtn.Parent = root

local helpText = Instance.new("TextLabel")
helpText.Size = UDim2.new(1, 0, 0, 48)
helpText.LayoutOrder = 7
helpText.BackgroundTransparency = 1
helpText.Font = Enum.Font.Gotham
helpText.TextSize = 11.5
helpText.TextWrapped = true
helpText.TextXAlignment = Enum.TextXAlignment.Left
helpText.TextYAlignment = Enum.TextYAlignment.Top
helpText.TextColor3 = Color3.fromRGB(140, 140, 148)
helpText.Text = "Cadence Animator must be running on this machine. This plugin connects OUT to it — nothing listens on Studio's side."
helpText.Parent = root

-- ==================================================================== toolbar UI

local toolbar = plugin:CreateToolbar("Cadence Animator")

-- iconname ("") is intentionally empty — a real custom icon needs an asset uploaded to Roblox,
-- which requires an authenticated Roblox account this app has no way to act as. Per Roblox's own
-- docs, when iconname is unset the button falls back to displaying `text` instead, so we pass an
-- explicit emoji-prefixed label there rather than leaving these blank.
local connectBtn = toolbar:CreateButton("Connect", "Connect to / disconnect from the Cadence Animator desktop app", "", "🔌 Connect")
local statusBtn = toolbar:CreateButton("Status", "Show connection status, port, and place — click to open the Cadence Bridge panel", "", "📶 Status")
local pushBtn = toolbar:CreateButton("Send Selection", "Send the selected rig to Cadence right now", "", "📤 Send Selection")
local syncBtn = toolbar:CreateButton("Sync Pose", "Re-read the selected rig's current geometry (after using Studio's Move/Rotate tools) and push the correction to Cadence", "", "🔄 Sync Pose")

local function fmtAgo(clockTime)
	if not clockTime then
		return "never"
	end
	local s = math.floor(os.clock() - clockTime)
	if s < 2 then
		return "just now"
	elseif s < 60 then
		return s .. "s ago"
	elseif s < 3600 then
		return math.floor(s / 60) .. "m ago"
	end
	return math.floor(s / 3600) .. "h ago"
end

-- isOn: true = connected, false = disconnected/error, nil = connecting (transient)
setStatus = function(isOn)
	connectBtn:SetActive(isOn == true)
	statusBtn:SetActive(widget.Enabled)
	if isOn == nil then
		dot.BackgroundColor3 = Color3.fromRGB(240, 185, 92)
		statusText.Text = "Connecting…"
	elseif isOn then
		dot.BackgroundColor3 = Color3.fromRGB(95, 217, 154)
		statusText.Text = "Connected"
	else
		dot.BackgroundColor3 = lastError and Color3.fromRGB(242, 104, 107) or Color3.fromRGB(140, 140, 148)
		statusText.Text = lastError and "Connection error" or "Disconnected"
	end
	placeValue.Text = connected and ((game.Name ~= "" and game.Name) or "Untitled place") or "—"
	lastSeenValue.Text = fmtAgo(lastContact)
	errorText.Visible = lastError ~= nil
	errorText.Text = lastError or ""
	toggleBtn.Text = running and "🔌  Disconnect" or "🔌  Connect"
	toggleBtn.BackgroundColor3 = running and Color3.fromRGB(60, 62, 72) or Color3.fromRGB(90, 100, 235)
end

-- keep "Last contact" fresh while the panel is open, even between poll ticks
task.spawn(function()
	while true do
		task.wait(1)
		if widget.Enabled then
			lastSeenValue.Text = fmtAgo(lastContact)
		end
	end
end)

connectBtn.Click:Connect(function()
	if running then
		disconnect()
	else
		connect()
	end
end)

statusBtn.Click:Connect(function()
	widget.Enabled = not widget.Enabled
	statusBtn:SetActive(widget.Enabled)
end)

toggleBtn.MouseButton1Click:Connect(function()
	if running then
		disconnect()
	else
		connect()
	end
end)

pushBtn.Click:Connect(function()
	local sel = Selection:Get()
	if #sel == 0 then
		warn("[Cadence] Select a rig's Model first")
		return
	end
	local model = sel[1]
	if not model:IsA("Model") then
		model = model:FindFirstAncestorWhichIsA("Model") or model
	end
	local ok, rigOrErr = pcall(serializeRig, model, model.Name)
	if not ok then
		warn("[Cadence] " .. tostring(rigOrErr))
		return
	end
	local id = ensureCadenceId(model)
	local okSend, err = pcall(post, "/event", { type = "rigPushed", data = { rig = rigOrErr, studioId = id } })
	if not okSend then
		warn("[Cadence] Could not reach the Cadence app — is it running and connected?")
	end
end)

syncBtn.Click:Connect(function()
	local sel = Selection:Get()
	if #sel == 0 then
		warn("[Cadence] Select the rig you want to re-sync first")
		return
	end
	local model = sel[1]
	if not model:IsA("Model") then
		model = model:FindFirstAncestorWhichIsA("Model") or model
	end
	local id = model:GetAttribute("CadenceId")
	if not id then
		warn("[Cadence] This rig was never linked from Cadence — use 'Send Selection' first")
		return
	end
	local ok, rigOrErr = pcall(serializeRig, model, model.Name)
	if not ok then
		warn("[Cadence] " .. tostring(rigOrErr))
		return
	end
	local okSend = pcall(post, "/event", { type = "rigResynced", data = { rig = rigOrErr, studioId = id } })
	if not okSend then
		warn("[Cadence] Could not reach the Cadence app — is it running and connected?")
	end
end)

setStatus(false)

-- ==================================================================== lifecycle

-- No editor state lives in this plugin, so there is nothing to flush here — closing Studio,
-- with or without this plugin loaded, can never wipe animation data the way Moon Animator could.
plugin.Unloading:Connect(function()
	running = false
end)

game:BindToClose(function()
	running = false
end)
