local FALLBACK_KEY = "oleafly-fallback-bibliography"

local function read_text(path)
  local read_file = pandoc.system.read_file
  if read_file then
    local ok, text = pcall(read_file, path)
    return ok and text or nil
  end
  local ok, _, contents = pcall(pandoc.mediabag.fetch, path)
  return ok and contents or nil
end

local function is_file(path)
  local exists = pandoc.path.exists
  if exists then
    local ok, found = pcall(exists, path, "file")
    return ok and found == true
  end
  return read_text(path) ~= nil
end

local function is_absolute(path)
  return path:match("^/") ~= nil or path:match("^%a:[/\\]") ~= nil or path:match("^[/\\][/\\]") ~= nil
end

local function resolve(entry)
  if entry == "" then
    return nil
  end
  if is_absolute(entry) then
    return is_file(entry) and entry or nil
  end
  for _, directory in ipairs((PANDOC_STATE and PANDOC_STATE.resource_path) or { "." }) do
    local candidate = pandoc.path.join({ directory, entry })
    if is_file(candidate) then
      return candidate
    end
  end
  return nil
end

local function meta_entries(value)
  if value == nil then
    return {}
  end
  if type(value) == "string" then
    return { value }
  end
  if pandoc.utils.type(value) == "List" then
    local entries = {}
    for _, item in ipairs(value) do
      entries[#entries + 1] = pandoc.utils.stringify(item)
    end
    return entries
  end
  return { pandoc.utils.stringify(value) }
end

local function cited_keys(doc)
  local keys = {}
  local function take(cite)
    for _, citation in ipairs(cite.citations) do
      keys[citation.id:lower()] = true
    end
  end
  doc:walk({ Cite = take })
  if doc.meta.nocite ~= nil then
    pandoc.Pandoc({}, { nocite = doc.meta.nocite }):walk({ Cite = take })
  end
  return keys
end

local function escaped(text)
  return (text:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0"))
end

local function defines_a_key(path, keys)
  if keys["*"] then
    return true
  end
  local text = read_text(path)
  if not text then
    return false
  end
  text = text:lower()
  for key in pairs(keys) do
    if text:find("@%a+%s*[{(]%s*" .. escaped(key) .. "%s*,") then
      return true
    end
  end
  return false
end

function Pandoc(doc)
  local fallback = meta_entries(doc.meta[FALLBACK_KEY])
  doc.meta[FALLBACK_KEY] = nil
  local declared = meta_entries(doc.meta.bibliography)
  local keys = cited_keys(doc)
  if next(keys) == nil then
    doc.meta.bibliography = nil
    return doc
  end
  if #declared == 0 and #fallback == 0 and doc.meta.references == nil then
    return doc:walk({
      Cite = function(cite)
        return cite.content
      end,
    })
  end
  local chosen, seen, missing = pandoc.List(), {}, 0
  local function add(path)
    if not seen[path] then
      seen[path] = true
      chosen:insert(path)
    end
  end
  for _, entry in ipairs(declared) do
    local found = resolve(entry)
    if found then
      add(found)
    else
      missing = missing + 1
    end
  end
  local kept = #chosen
  if missing > 0 or (#declared == 0 and doc.meta.references == nil) then
    for _, path in ipairs(fallback) do
      if is_file(path) and defines_a_key(path, keys) then
        add(path)
      end
    end
  end
  if missing > 0 and #chosen == kept then
    return doc
  end
  if #chosen > 0 then
    doc.meta.bibliography = chosen
  else
    doc.meta.bibliography = nil
  end
  return doc
end
