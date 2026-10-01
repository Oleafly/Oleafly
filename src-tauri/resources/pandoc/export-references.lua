-- Oleafly export filter for the rendered formats (Word, HTML, EPUB,
-- PowerPoint, plain text). It runs before --citeproc and does three things:
--
-- 1. Bibliography: keeps every bibliography the document declares that can be
--    read through the resource path (main document folder first, then the
--    project root). When a declared file is missing, or the document declares
--    none, the .bib files Oleafly found next to the main document or at the
--    project root are added, so citeproc never drops a citation silently.
--    A document that cites nothing reads no bibliography at all.
-- 2. Cross-references: \ref, \eqref, \cref, \Cref and \autoref render the
--    number from the last compile's .aux when Oleafly passed one, and a
--    readable "(label)" instead of pandoc's "[label]" placeholder otherwise.
-- 3. Display math: \label is removed (texmath cannot parse it everywhere),
--    labelled equations show their number, and \tag / \notag are rewritten
--    into forms texmath renders.
--
-- The data file sits next to this script. Each line is tab-separated:
--   bibliography <TAB> path relative to the project root
--   label <TAB> name <TAB> number <TAB> kind
--   bibcite <TAB> key <TAB> label
--
-- Files are read through pandoc, never Lua's C library: on Windows that opens
-- paths in the ANSI code page, so a folder with a non-ASCII name (a profile
-- such as C:\Users\Zoë, where Oleafly keeps its data) would read as
-- missing. Pandoc takes UTF-8 paths on every platform.

local data = { fallback = {}, labels = {}, bibcite = {} }

-- The contents of a file, or nil when it cannot be read.
local function read_text(path)
  local read_file = pandoc.system.read_file
  if read_file then
    local ok, text = pcall(read_file, path)
    return ok and text or nil
  end
  -- Pandoc before read_file existed.
  local ok, _, contents = pcall(pandoc.mediabag.fetch, path)
  return ok and contents or nil
end

-- Whether a regular file exists at path (a folder does not count).
local function is_file(path)
  local exists = pandoc.path.exists
  if exists then
    local ok, found = pcall(exists, path, "file")
    return ok and found == true
  end
  return read_text(path) ~= nil
end

local function script_directory()
  local file = PANDOC_SCRIPT_FILE or ""
  return file:match("^(.*)[/\\][^/\\]*$") or "."
end

local function split_tabs(line)
  local fields = {}
  for field in (line .. "\t"):gmatch("([^\t]*)\t") do
    fields[#fields + 1] = field
  end
  return fields
end

local function load_data()
  local text = read_text(script_directory() .. "/export-references.tsv")
  if not text then
    return
  end
  for raw in text:gmatch("[^\n]+") do
    local fields = split_tabs((raw:gsub("\r$", "")))
    local kind = fields[1]
    if kind == "bibliography" and (fields[2] or "") ~= "" then
      data.fallback[#data.fallback + 1] = fields[2]
    elseif kind == "label" and #fields >= 4 and fields[2] ~= "" then
      data.labels[fields[2]] = { number = fields[3], kind = fields[4] }
    elseif kind == "bibcite" and #fields >= 3 and fields[2] ~= "" then
      data.bibcite[fields[2]] = fields[3]
    end
  end
end

-- Bibliography ---------------------------------------------------------------

local function is_absolute(path)
  return path:match("^/") ~= nil or path:match("^%a:[/\\]") ~= nil or path:match("^[/\\][/\\]") ~= nil
end

-- The data names fallback files relative to the project root, where pandoc
-- runs. Citeproc would look a relative name up from the main document's
-- folder first and could read a same-named file there, so it gets the full
-- path, which stays in memory.
local function from_project_root(path)
  if is_absolute(path) then
    return path
  end
  local working_directory = pandoc.system.get_working_directory
  if not working_directory then
    return path
  end
  local ok, directory = pcall(working_directory)
  if not ok or not directory or directory == "" then
    return path
  end
  return directory .. "/" .. path
end

local function resolve_bibliography(entry)
  if entry == "" then
    return nil
  end
  if is_absolute(entry) then
    return is_file(entry) and entry or nil
  end
  local search = (PANDOC_STATE and PANDOC_STATE.resource_path) or { "." }
  for _, directory in ipairs(search) do
    local candidate = entry
    if directory ~= "" and directory ~= "." then
      candidate = directory .. "/" .. entry
    end
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
  if pandoc.utils.type(value) == "List" then
    local entries = {}
    for _, item in ipairs(value) do
      entries[#entries + 1] = pandoc.utils.stringify(item)
    end
    return entries
  end
  return { pandoc.utils.stringify(value) }
end

local function has_thebibliography(doc)
  local found = false
  doc:walk({
    Div = function(div)
      if div.classes:includes("thebibliography") then
        found = true
      end
    end,
  })
  return found
end

-- Whether the document cites anything: \cite in the text, a footnote or the
-- metadata, or \nocite.
local function cites_anything(doc)
  if doc.meta.nocite ~= nil then
    return true
  end
  local found = false
  doc:walk({
    Cite = function()
      found = true
    end,
  })
  return found
end

local function choose_bibliography(doc, manual_list)
  local declared = meta_entries(doc.meta.bibliography)
  if not cites_anything(doc) then
    -- Nothing to look up: citeproc reads no file, so a stray or broken .bib
    -- cannot fail the export and a large one is not parsed for nothing.
    doc.meta.bibliography = nil
    return #declared
  end
  local chosen, seen, missing = pandoc.List(), {}, 0
  local function add(path)
    if not seen[path] then
      seen[path] = true
      chosen:insert(path)
    end
  end
  for _, entry in ipairs(declared) do
    local found = resolve_bibliography(entry)
    if found then
      add(found)
    else
      missing = missing + 1
    end
  end
  local declares_nothing = #declared == 0 and doc.meta.references == nil and not manual_list
  if missing > 0 or declares_nothing then
    for _, path in ipairs(data.fallback) do
      local full = from_project_root(path)
      if is_file(full) then
        add(full)
      end
    end
  end
  if #chosen > 0 then
    doc.meta.bibliography = chosen
  else
    doc.meta.bibliography = nil
  end
  return #declared
end

-- Without a compile, a hand-written list is numbered the way LaTeX numbers
-- it: \bibitem order in the source, or the item's own [label].
local function scan_bibitems()
  local labels, count = {}, 0
  for _, file in ipairs((PANDOC_STATE and PANDOC_STATE.input_files) or {}) do
    local text = read_text(file)
    if text then
      local position = 1
      while true do
        local _, finish = text:find("\\bibitem%f[^%a]", position)
        if not finish then
          break
        end
        position = finish + 1
        local own
        local _, option_end, option = text:find("^%s*(%b[])", position)
        if option_end then
          own = option:sub(2, -2)
          position = option_end + 1
        end
        local _, key_end, key = text:find("^%s*(%b{})", position)
        if key_end then
          position = key_end + 1
          local name = key:sub(2, -2):match("^%s*(.-)%s*$")
          if name ~= "" and not labels[name] then
            count = count + 1
            labels[name] = own or tostring(count)
          end
        end
      end
    end
  end
  return labels
end

-- A hand-written thebibliography keeps its own list; its \cite labels come
-- from the \bibcite records of the last compile, or from the source.
local function number_manual_citations(doc)
  local labels_for = data.bibcite
  if next(labels_for) == nil then
    labels_for = scan_bibitems()
  end
  return doc:walk({
    Cite = function(cite)
      local labels = {}
      for _, citation in ipairs(cite.citations) do
        local label = labels_for[citation.id]
        if not label then
          return nil
        end
        labels[#labels + 1] = label
      end
      return pandoc.Str("[" .. table.concat(labels, ", ") .. "]")
    end,
    -- The widest-label argument ({9}) is not an entry.
    Div = function(div)
      if not div.classes:includes("thebibliography") then
        return nil
      end
      local first = div.content[1]
      if first and first.t == "Para" and first.content[1] and first.content[1].t == "Span"
        and first.content[1].identifier == "" and #first.content[1].classes == 0 then
        first.content:remove(1)
        if first.content[1] and first.content[1].t == "SoftBreak" then
          first.content:remove(1)
        end
      end
      return div
    end,
  })
end

-- Cross-references -------------------------------------------------------------

local SHORT_NAMES = {
  equation = "eq.",
  section = "section",
  subsection = "section",
  subsubsection = "section",
  chapter = "chapter",
  appendix = "appendix",
  figure = "fig.",
  table = "table",
  theorem = "theorem",
  lemma = "lemma",
  corollary = "corollary",
  proposition = "proposition",
  definition = "definition",
  footnote = "footnote",
  item = "item",
}

local LONG_NAMES = {
  equation = "Equation",
  section = "Section",
  subsection = "Section",
  subsubsection = "Section",
  chapter = "Chapter",
  appendix = "Appendix",
  figure = "Figure",
  table = "Table",
  theorem = "Theorem",
  lemma = "Lemma",
  corollary = "Corollary",
  proposition = "Proposition",
  definition = "Definition",
  footnote = "Footnote",
  item = "Item",
}

local function number_inlines(number)
  if number:find("[\\$]") then
    return { pandoc.Math("InlineMath", (number:gsub("%$", ""))) }
  end
  return { pandoc.Str(number) }
end

local function wrapped(inlines, before, after)
  local out = pandoc.List({ pandoc.Str(before) })
  out:extend(inlines)
  out:insert(pandoc.Str(after))
  return out
end

local function render_reference(reference_type, entry)
  local number = number_inlines(entry.number)
  local is_equation = entry.kind == "equation"
  if reference_type == "eqref" then
    return wrapped(number, "(", ")")
  end
  if reference_type == "ref+label" or reference_type == "ref+Label" then
    local names = reference_type == "ref+Label" and LONG_NAMES or SHORT_NAMES
    local name = names[entry.kind]
    local shown = is_equation and wrapped(number, "(", ")") or pandoc.List(number)
    if name then
      local out = pandoc.List({ pandoc.Str(name), pandoc.Str("\u{a0}") })
      out:extend(shown)
      return out
    end
    return shown
  end
  return pandoc.List(number)
end

local function split_labels(reference)
  local labels = {}
  for label in reference:gmatch("[^,]+") do
    local trimmed = label:match("^%s*(.-)%s*$")
    if trimmed ~= "" then
      labels[#labels + 1] = trimmed
    end
  end
  return labels
end

local function collect_identifiers(doc)
  local ids = {}
  local function note(element)
    if element.identifier and element.identifier ~= "" then
      ids[element.identifier] = true
    end
  end
  doc:walk({
    Header = note,
    Div = note,
    Span = note,
    Figure = note,
    Table = note,
    CodeBlock = note,
    Image = note,
  })
  return ids
end

local REFERENCE_TYPES = { ref = true, eqref = true, ["ref+label"] = true, ["ref+Label"] = true }

local function resolve_link(link, ids)
  local reference_type = link.attributes["reference-type"]
  local reference = link.attributes["reference"]
  if not REFERENCE_TYPES[reference_type] or not reference or reference == "" then
    return nil
  end
  local labels = split_labels(reference)
  local all_known = #labels > 0
  for _, label in ipairs(labels) do
    if not data.labels[label] then
      all_known = false
    end
  end
  local content
  if all_known then
    content = pandoc.List()
    for index, label in ipairs(labels) do
      if index > 1 then
        content:insert(pandoc.Str(","))
        content:insert(pandoc.Space())
      end
      content:extend(render_reference(reference_type, data.labels[label]))
    end
  elseif pandoc.utils.stringify(link.content) == "[" .. reference .. "]" then
    -- Pandoc could not resolve the label (equations, or no compile yet).
    content = pandoc.List({ pandoc.Str("(" .. reference .. ")") })
  else
    -- Pandoc numbered it itself (sections, figures, tables).
    return nil
  end
  if #labels == 1 and ids[labels[1]] then
    link.content = content
    return link
  end
  -- Nothing in the exported document carries this anchor; plain text avoids
  -- a dead link.
  return content
end

-- Display math -----------------------------------------------------------------

local function strip_dollars(text)
  return (text:gsub("%$", ""))
end

local function rewrite_display_math(math)
  if math.mathtype ~= "DisplayMath" then
    return nil
  end
  local text = math.text
  local original = text
  local tags = {}
  text = text:gsub("\\notag%f[^%a]", "\\nonumber")
  text = text:gsub("\\tag(%*?)%s*(%b{})", function(star, group)
    local value = strip_dollars(group:sub(2, -2))
    tags[value] = true
    if star == "*" then
      return "\\qquad " .. value
    end
    return "\\qquad(" .. value .. ")"
  end)
  local labels = {}
  for label in text:gmatch("\\label%s*(%b{})") do
    labels[#labels + 1] = label:sub(2, -2)
  end
  local function tag_for(label)
    local entry = data.labels[label]
    if not entry then
      return ""
    end
    local number = strip_dollars(entry.number)
    if tags[number] then
      return ""
    end
    return "\\qquad(" .. number .. ")"
  end
  if #labels == 1 then
    text = text:gsub("\\label%s*%b{}", " ")
    local tag = tag_for(labels[1])
    if tag ~= "" then
      local head, tail = text:match("^(.*)(\\end%s*%b{}%s*)$")
      if head then
        text = head .. tag .. tail
      else
        text = text .. tag
      end
    end
  elseif #labels > 1 then
    text = text:gsub("\\label%s*(%b{})", function(group)
      local tag = tag_for(group:sub(2, -2))
      return tag ~= "" and tag or " "
    end)
  end
  if text == original then
    return nil
  end
  math.text = text
  return math
end

-- A label set inside display math names an equation, whatever the .aux
-- recorded (hyperref and cleveref are optional).
local function mark_equation_labels(doc)
  doc:walk({
    Math = function(math)
      if math.mathtype ~= "DisplayMath" then
        return nil
      end
      for group in math.text:gmatch("\\label%s*(%b{})") do
        local entry = data.labels[group:sub(2, -2)]
        if entry and entry.kind == "" then
          entry.kind = "equation"
        end
      end
    end,
  })
end

-- Entry point ------------------------------------------------------------------

function Pandoc(doc)
  load_data()
  mark_equation_labels(doc)
  local manual_list = has_thebibliography(doc)
  local declared = choose_bibliography(doc, manual_list)
  if manual_list and declared == 0 then
    doc = number_manual_citations(doc)
  end
  local ids = collect_identifiers(doc)
  return doc:walk({
    Math = rewrite_display_math,
    Link = function(link)
      return resolve_link(link, ids)
    end,
  })
end
