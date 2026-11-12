local KIND = "oleafly-document-kind"
local POSTER_SIZES = { a0 = true, a1 = true, a2 = true, a3 = true, a4 = true }

local function is_list(value)
  return pandoc.utils.type(value) == "List"
end

local function latex(value)
  if value == nil then
    return nil
  end
  if is_list(value) then
    local lines = {}
    for _, item in ipairs(value) do
      lines[#lines + 1] = latex(item)
    end
    return table.concat(lines, "\\\\ ")
  end
  if pandoc.utils.type(value) == "Blocks" then
    local text = pandoc.write(pandoc.Pandoc(value), "latex"):gsub("%s+$", "")
    return (text:gsub("\n\n+", "\\\\ "))
  end
  if type(value) ~= "table" then
    value = tostring(value)
  end
  local text = pandoc.write(pandoc.Pandoc({ pandoc.Plain(pandoc.Inlines(value)) }), "latex")
  return (text:gsub("%s+$", ""))
end

local function names(value)
  if not is_list(value) then
    return latex(value)
  end
  local parts = {}
  for _, item in ipairs(value) do
    parts[#parts + 1] = latex(item)
  end
  return table.concat(parts, ", ")
end

local function set_default(meta, key, value)
  if meta[key] == nil then
    meta[key] = value
  end
end

local function include(meta, code)
  local includes = meta["header-includes"]
  if includes == nil then
    includes = pandoc.MetaList({})
  elseif not is_list(includes) then
    includes = pandoc.MetaList({ includes })
  end
  includes:insert(pandoc.MetaBlocks({ pandoc.RawBlock("latex", code) }))
  meta["header-includes"] = includes
end

local function add_class_option(meta, option)
  local options = meta.classoption
  if options == nil then
    options = pandoc.MetaList({})
  elseif not is_list(options) then
    options = pandoc.MetaList({ options })
  end
  for _, existing in ipairs(options) do
    if pandoc.utils.stringify(existing) == option then
      return
    end
  end
  options:insert(option)
  meta.classoption = options
end

local kinds = {}

function kinds.report(doc)
  set_default(doc.meta, "documentclass", "report")
end

function kinds.book(doc)
  set_default(doc.meta, "documentclass", "book")
end

function kinds.slides(doc)
  set_default(doc.meta, "aspectratio", "169")
end

function kinds.cv(doc)
  set_default(doc.meta, "geometry", "margin=2cm")
  set_default(doc.meta, "pagestyle", "empty")
end

function kinds.poster(doc)
  local meta = doc.meta
  local size = "a0"
  if meta.papersize ~= nil then
    local named = pandoc.utils.stringify(meta.papersize):lower():gsub("paper$", "")
    if POSTER_SIZES[named] then
      size = named
    end
  end
  meta.papersize = nil
  local orientation = "portrait"
  if meta.orientation ~= nil and pandoc.utils.stringify(meta.orientation):lower() == "landscape" then
    orientation = "landscape"
  end
  include(meta, "\\usepackage[size=" .. size .. ",orientation=" .. orientation .. ",scale=1.4]{beamerposter}")
  add_class_option(meta, "t")
  if meta.title == nil then
    return
  end
  local lines = { "\\begin{center}", "{\\VeryHuge\\bfseries " .. latex(meta.title) .. "\\par}" }
  if meta.subtitle ~= nil then
    lines[#lines + 1] = "\\vspace{0.3em}{\\huge " .. latex(meta.subtitle) .. "\\par}"
  end
  if meta.author ~= nil then
    lines[#lines + 1] = "\\vspace{0.6em}{\\Large " .. names(meta.author) .. "\\par}"
  end
  if meta.institute ~= nil then
    lines[#lines + 1] = "{\\large " .. names(meta.institute) .. "\\par}"
  end
  lines[#lines + 1] = "\\end{center}"
  lines[#lines + 1] = "\\vspace{1em}"
  doc.blocks:insert(1, pandoc.RawBlock("latex", table.concat(lines, "\n")))
  set_default(meta, "title-meta", pandoc.utils.stringify(meta.title))
  meta.title = nil
  meta.subtitle = nil
end

function kinds.letter(doc)
  local meta = doc.meta
  set_default(meta, "documentclass", "scrlttr2")
  local subject = meta.subject or meta.title
  if pandoc.utils.stringify(meta.documentclass) == "scrlttr2" then
    if meta.author ~= nil then
      include(meta, "\\setkomavar{fromname}{" .. names(meta.author) .. "}")
    end
    if meta.from ~= nil then
      include(meta, "\\setkomavar{fromaddress}{" .. latex(meta.from) .. "}")
    end
    if subject ~= nil then
      include(meta, "\\setkomavar{subject}{" .. latex(subject) .. "}")
    end
  else
    if meta.from ~= nil then
      include(meta, "\\address{" .. latex(meta.from) .. "}")
    end
    if meta.author ~= nil then
      include(meta, "\\signature{" .. names(meta.author) .. "}")
    end
  end
  local blocks = pandoc.Blocks({
    pandoc.RawBlock(
      "latex",
      "\\begin{letter}{" .. (latex(meta.to) or "") .. "}\n\\opening{" .. (latex(meta.opening) or "") .. "}"
    ),
  })
  blocks:extend(doc.blocks)
  blocks:insert(pandoc.RawBlock("latex", "\\closing{" .. (latex(meta.closing) or "") .. "}\n\\end{letter}"))
  doc.blocks = blocks
  meta.title = nil
end

function Pandoc(doc)
  local kind = doc.meta[KIND] and pandoc.utils.stringify(doc.meta[KIND])
  doc.meta[KIND] = nil
  local shape = kind and kinds[kind]
  if shape and (FORMAT == "latex" or FORMAT == "beamer") then
    shape(doc)
  end
  return doc
end
