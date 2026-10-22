-- Exports what the interactive map needs:
--   loca/<lang>.tsv      translations (id \t text)
--   map/<name>.png       world map tiles and shader parameter textures
--   map/<name>.r16       raw 16-bit textures (base height map)
--   icons/<guid>.png     map marker icons, plus icons/index.tsv (guid \t debugName)

local MAP_GUID = "01bcbd07-bdbf-41c0-9999-5d58fb1a3aa1"
local LANGUAGES = { "Fr_Fr", "En_Us" }

local function escape(text)
	return (text:gsub("\\", "\\\\"):gsub("\t", "\\t"):gsub("\r", "\\r"):gsub("\n", "\\n"))
end

local function export_translations()
	---@type keen.LocaTagCollectionResource
	local loca = game.assets.get_resources_by_type("keen::LocaTagCollectionResource")[1].data

	for _, lang in ipairs(LANGUAGES) do
		for _, entry in ipairs(loca.languages) do
			if entry.language == lang then
				local buf = game.assets.get_content(entry.data.hash):read_data()
				---@type keen.LocaTagCollectionResourceData
				local data = buf:read_resource("keen::LocaTagCollectionResourceData")
				local lines = {}
				for _, tag in ipairs(data.tags) do
					lines[#lines + 1] = tostring(tag.id.value) .. "\t" .. escape(tag.text)
				end
				io.export("loca/" .. lang .. ".tsv", table.concat(lines, "\n"))
				print("exported " .. #lines .. " translations for " .. lang)
			end
		end
	end
end

---@param texture keen.UiTextureResource
local function decode(texture)
	local buf = game.assets.get_content(texture.data.hash):read_data()
	return image.decode_texture(buf, texture.format, texture.size.x, texture.size.y)
end

local function export_map()
	local count = 0
	for _, res in ipairs(game.assets.get_resource_parts(MAP_GUID, "keen::UiTextureResource")) do
		---@type keen.UiTextureResource
		local texture = res.data
		local name = texture.debugName:gsub("[^%w_%-]", "_")
		if texture.format == "R16_unorm" then
			io.export("map/" .. name .. ".r16", game.assets.get_content(texture.data.hash):read_data())
		end
		io.export("map/" .. name .. ".png", image.encode(decode(texture), "png"))
		count = count + 1
	end
	print("exported " .. count .. " map textures")
end

local function export_icons()
	local wanted = {}
	---@type keen.MapMarkerRegistryResource
	local registry = game.assets.get_resources_by_type("keen::MapMarkerRegistryResource")[1].data
	for _, marker in ipairs(registry.mapMarkers.values) do
		if marker.icon.image ~= nil then wanted[tostring(marker.icon.image)] = true end
		if marker.mutedIcon.image ~= nil then wanted[tostring(marker.mutedIcon.image)] = true end
	end

	local index = {}
	for _, res in ipairs(game.assets.get_resources_by_type("keen::UiTextureResource")) do
		---@type keen.UiTextureResource
		local texture = res.data
		local guid = tostring(res.guid)
		if wanted[guid] or texture.debugName:find("^mapmarker_") then
			io.export("icons/" .. guid .. ".png", image.encode(decode(texture), "png"))
			index[#index + 1] = guid .. "\t" .. texture.debugName
		end
	end
	io.export("icons/index.tsv", table.concat(index, "\n"))
	print("exported " .. #index .. " icons")
end

-- Raw terrain voxel tiles: voxels/<level>/<x>_<y>.bin
local WORLD_GUID = "509feadb-4c60-425f-9c7c-deeefd9b6920"
-- Level 5 is 1 m per voxel (used by extract_surface.py); lower levels are
-- coarser (level 4 = 2 m, level 2 = 8 m).
local VOXEL_LEVELS = { [5] = true }

local function export_voxels()
	---@type keen.VoxelWorldResource
	local world = game.assets.get_resource(WORLD_GUID, "keen::VoxelWorldResource", 0).data
	for level, info in ipairs(world.voxelLevels) do
		local index = level - 1
		if VOXEL_LEVELS[index] then
			local count = 0
			for i, tile in ipairs(info.tiles) do
				local x = (i - 1) % info.tileCount.x
				local y = (i - 1) // info.tileCount.x
				local content = game.assets.get_content(tile.hash)
				if content ~= nil then
					io.export(string.format("voxels/%d/%d_%d.bin", index, x, y), content:read_data())
					count = count + 1
				end
			end
			print("exported " .. count .. " voxel tiles for level " .. index)
		end
	end
end

local args = { translations = false, icons = false, map = false, voxels = true }
if args.translations then export_translations() end
if args.icons then export_icons() end
if args.map then export_map() end
if args.voxels then export_voxels() end
