local function is_file(path)
  local exists = pandoc.path and pandoc.path.exists
  if exists then
    local ok, found = pcall(exists, path, "file")
    return ok and found == true
  end
  local handle = io.open(path, "rb")
  if handle then
    handle:close()
    return true
  end
  return false
end

local function figure_hash(text)
  local hash = 0xcbf29ce484222325
  for index = 1, #text do
    hash = (hash ~ text:byte(index)) * 0x100000001b3
  end
  return string.format("%016x", hash)
end

local function saved_figure(text)
  local name = "figures/mermaid-" .. figure_hash(text) .. ".png"
  for _, directory in ipairs(PANDOC_STATE.resource_path or {}) do
    if is_file(pandoc.path.join({ directory, name })) then
      return name
    end
  end
  return nil
end

function CodeBlock(block)
  if not block.classes:includes("mermaid") then
    return nil
  end
  local name = saved_figure(block.text)
  if not name then
    return nil
  end
  local image = pandoc.Para({ pandoc.Image({}, name) })
  if FORMAT:match("latex") then
    return {
      pandoc.RawBlock("latex", "\\begin{center}"),
      image,
      pandoc.RawBlock("latex", "\\end{center}"),
    }
  end
  return image
end
