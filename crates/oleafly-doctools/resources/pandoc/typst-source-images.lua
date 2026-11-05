local function segments(path)
  local found = {}
  for part in path:gmatch("[^/\\]+") do
    if part == ".." then
      found[#found] = nil
    elseif part ~= "." then
      found[#found + 1] = part
    end
  end
  return found
end

local project_folder = pandoc.system.environment().OLEAFLY_EXPORT_PROJECT_FOLDER
local project_segments = segments(project_folder)

local function inside_project(path)
  local found = segments(path)
  if #found <= #project_segments then
    return false
  end
  for index, part in ipairs(project_segments) do
    if found[index] ~= part then
      return false
    end
  end
  return true
end

function Image(image)
  if inside_project(image.src) then
    return nil
  end
  local from_project = project_folder .. "/" .. image.src
  if image.src:match("^[/\\]") and inside_project(from_project) then
    image.src = from_project
    return image
  end
  return {}
end
