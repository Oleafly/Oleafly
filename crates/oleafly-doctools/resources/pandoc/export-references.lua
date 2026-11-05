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
    local pattern = key:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")
    if text:find("@%a+%s*[{(]%s*" .. pattern .. "%s*,") then
      return true
    end
  end
  return false
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
    local keys = cited_keys(doc)
    for _, path in ipairs(data.fallback) do
      local full = from_project_root(path)
      if is_file(full) and defines_a_key(full, keys) then
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

local references_unnumbered = false

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
    references_unnumbered = true
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

local function is_plain_span(inline)
  return inline ~= nil and inline.t == "Span" and inline.identifier == "" and #inline.classes == 0
end

local function drop_cjk_arguments(div)
  if not (div.classes:includes("CJK") or div.classes:includes("CJK*")) then
    return nil
  end
  local first = div.content[1]
  if not first or first.t ~= "Para" then
    return nil
  end
  for _ = 1, 2 do
    if is_plain_span(first.content[1]) then
      first.content:remove(1)
    end
  end
  if first.content[1] and first.content[1].t == "SoftBreak" then
    first.content:remove(1)
  end
  if #first.content == 0 then
    div.content:remove(1)
  end
  return div
end

local SOURCE_FORMATS = { markdown = true, typst = true }

local IMAGE_SUFFIXES = {
  "",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".PDF",
  ".PNG",
  ".JPG",
  ".JPEG",
  ".gif",
  ".webp",
  ".svg",
  ".eps",
}

local SHOWS_NO_PDF = { pdf = true, eps = true }
local SHOWS_NO_VECTOR = { pdf = true, eps = true, svg = true, webp = true }

local IMAGE_LIMITS = {
  docx = SHOWS_NO_VECTOR,
  pptx = SHOWS_NO_VECTOR,
  epub = SHOWS_NO_PDF,
  epub2 = SHOWS_NO_PDF,
  epub3 = SHOWS_NO_PDF,
  html = SHOWS_NO_PDF,
  html5 = SHOWS_NO_PDF,
}

local IMAGE_PPI = 220
local IMAGE_PAGE = '#set page(width: auto, height: auto, margin: 0pt, fill: white)\n#image("%s")\n'

local function warn_export(marker, detail)
  local log = pandoc.log
  if log and log.warn then
    log.warn(detail and (marker .. " " .. detail) or marker)
  end
end

local function is_remote(source)
  return source:match("^%a[%w+.-]+:") ~= nil
end

local function main_folder()
  local search = (PANDOC_STATE and PANDOC_STATE.resource_path) or {}
  local main = search[1]
  return (main and is_absolute(main)) and main or nil
end

local function image_folders()
  local main = main_folder()
  local folders = pandoc.List()
  local function add(folder)
    if not folders:includes(folder) then
      folders:insert(folder)
    end
  end
  for _, entry in ipairs((PANDOC_STATE and PANDOC_STATE.resource_path) or { "." }) do
    if main and not is_absolute(entry) then
      add(pandoc.path.join({ main, entry }))
    end
    add(entry)
  end
  return folders
end

local function image_candidates(source)
  local names = { source }
  local decoded = source:gsub("%%(%x%x)", function(hex)
    return string.char(tonumber(hex, 16))
  end)
  if decoded ~= source then
    names[2] = decoded
  end
  return names
end

local function image_on_disk(source)
  if source == "" or is_remote(source) or pandoc.mediabag.lookup(source) then
    return nil
  end
  for _, name in ipairs(image_candidates(source)) do
    local folders = is_absolute(name) and { "" } or image_folders()
    for _, folder in ipairs(folders) do
      local base = folder == "" and name or pandoc.path.join({ folder, name })
      for _, suffix in ipairs(IMAGE_SUFFIXES) do
        if is_file(base .. suffix) then
          return base .. suffix
        end
      end
    end
  end
  return nil
end

local function extension_of(path)
  local extension = path:match("%.(%w+)$")
  return extension and extension:lower() or ""
end

local function picture_of(contents, extension, typst)
  return pandoc.system.with_temporary_directory("oleafly-figure", function(directory)
    return pandoc.system.with_working_directory(directory, function()
      local input = "input." .. extension
      pandoc.system.write_file(input, contents)
      pandoc.system.write_file("page.typ", string.format(IMAGE_PAGE, input))
      pandoc.pipe(typst, {
        "compile",
        "--root",
        ".",
        "--format",
        "png",
        "--ppi",
        tostring(IMAGE_PPI),
        "page.typ",
        "page.png",
      }, "")
      return pandoc.system.read_file("page.png")
    end)
  end)
end

local function environment_value(name)
  local ok, environment = pcall(pandoc.system.environment)
  if not ok then
    return nil
  end
  local value = environment[name]
  return (value and value ~= "") and value or nil
end

local function exports_project_images()
  return environment_value("OLEAFLY_EXPORT_PROJECT_IMAGES") ~= nil
end

local function typst_program()
  return environment_value("OLEAFLY_PANDOC_TYPST")
end

local function has_size(value)
  return value ~= nil and value:match("^[%d.]+%a*%%?$") ~= nil
end

local function natural_width(png)
  return string.format("%.3fin", string.unpack(">I4", png, 17) / IMAGE_PPI)
end

local converted_pictures = {}

local function converted_picture(path, extension)
  if converted_pictures[path] ~= nil then
    return converted_pictures[path]
  end
  local typst = typst_program()
  local contents = read_text(path)
  local picture = false
  if typst and contents and extension ~= "eps" then
    local ok, png = pcall(picture_of, contents, extension, typst)
    if ok and png and png ~= "" then
      local name = pandoc.utils.sha1(contents) .. ".png"
      pandoc.mediabag.insert(name, "image/png", png)
      picture = { name = name, width = natural_width(png) }
    end
  end
  converted_pictures[path] = picture
  return picture
end

local function embed_image(image, path)
  local contents = read_text(path)
  local extension = extension_of(path)
  if contents and extension ~= "" then
    local name = pandoc.utils.sha1(contents) .. "." .. extension
    pandoc.mediabag.insert(name, nil, contents)
    image.src = name
  end
  return image
end

local function project_link(path)
  local main = main_folder()
  if not main then
    return path
  end
  local ok, relative = pcall(pandoc.path.make_relative, path, main, true)
  return ((ok and relative) or path):gsub("\\", "/")
end

local function settle_image(image)
  local source = image.src
  local limits = IMAGE_LIMITS[FORMAT]
  local writes_source = SOURCE_FORMATS[FORMAT]
  if not limits and not writes_source then
    return nil
  end
  local path = image_on_disk(source)
  if not path then
    if writes_source and not is_remote(source) then
      warn_export("[oleafly:image-missing]", source)
    end
    return nil
  end
  if writes_source then
    image.src = (project_link(path))
    return image
  end
  local extension = extension_of(path)
  if not limits[extension] then
    return embed_image(image, path)
  end
  local picture = converted_picture(path, extension)
  if not picture then
    warn_export("[oleafly:image-unconverted]", source)
    return embed_image(image, path)
  end
  image.src = picture.name
  if not has_size(image.attributes.width) and not has_size(image.attributes.height) then
    image.attributes.width = picture.width
  end
  return image
end

local function drop_overlay(blocks)
  local first = blocks[1]
  if not first or first.t ~= "Para" then
    return
  end
  local leading = first.content[1]
  if not leading or leading.t ~= "Str" or not leading.text:match("^<[^>]*>") then
    return
  end
  first.content:remove(1)
  if first.content[1] and first.content[1].t == "SoftBreak" then
    first.content:remove(1)
  end
  if #first.content == 0 then
    blocks:remove(1)
  end
end

local function take_leading_span(blocks)
  local first = blocks[1]
  if not first or first.t ~= "Para" or not is_plain_span(first.content[1]) then
    return nil
  end
  local title = first.content:remove(1).content
  if first.content[1] and first.content[1].t == "SoftBreak" then
    first.content:remove(1)
  end
  if #first.content == 0 then
    blocks:remove(1)
  end
  return title
end

local function take_frame_heading(blocks)
  for index, block in ipairs(blocks) do
    if block.t == "Header" and block.level == 3 then
      blocks:remove(index)
      local following = blocks[index]
      if following and following.t == "Header" and following.level == 4 then
        blocks:remove(index)
        return block.content, following.content
      end
      return block.content, nil
    end
  end
  local title = take_leading_span(blocks)
  return title, title and take_leading_span(blocks)
end

local function clean_frame_div(div)
  if div.classes:includes("columns") or div.classes:includes("thebibliography") then
    return nil
  end
  if div.classes:includes("column") then
    take_leading_span(div.content)
    return div
  end
  if div.classes:includes("block") or div.classes:includes("alertblock")
    or div.classes:includes("exampleblock") then
    local title = take_leading_span(div.content)
    if title then
      div.content:insert(1, pandoc.Para({ pandoc.Strong(title) }))
    end
  end
  return div.content
end

local function is_blank_inline(inline)
  return inline.t == "Space" or inline.t == "SoftBreak" or inline.t == "LineBreak"
end

local function separate_images(para)
  local pieces, words, found = pandoc.List(), pandoc.List(), false
  local function close_words()
    while #words > 0 and is_blank_inline(words[#words]) do
      words:remove(#words)
    end
    if #words > 0 then
      pieces:insert(pandoc.Para(words))
      words = pandoc.List()
    end
  end
  for _, inline in ipairs(para.content) do
    if inline.t == "Image" then
      close_words()
      if pandoc.utils.stringify(inline.caption) == "image" then
        inline.caption = pandoc.Inlines({})
      end
      pieces:insert(pandoc.Para({ inline }))
      found = true
    elseif #words > 0 or not is_blank_inline(inline) then
      words:insert(inline)
    end
  end
  close_words()
  return found and pieces or nil
end

local function is_columns(block)
  return block.t == "Div" and block.classes:includes("columns")
end

local function two_columns(columns)
  local count = 0
  for _, child in ipairs(columns.content) do
    if child.t ~= "Div" or not child.classes:includes("column") then
      return false
    end
    count = count + 1
  end
  return count == 2
end

local function unwrapped_columns(columns)
  local blocks = pandoc.List()
  for _, column in ipairs(columns.content) do
    if column.t == "Div" then
      blocks:extend(column.content)
    else
      blocks:insert(column)
    end
  end
  return blocks
end

local function frame_source(text)
  if text:match("^\\begin%s*{frame}") then
    return text
  end
  local options, body = text:match("^\\frame%s*([^{]*)(%b{})%s*$")
  if not body then
    return nil
  end
  return "\\begin{frame}" .. options .. body:sub(2, -2) .. "\\end{frame}"
end

local function parsed_frame(raw)
  if raw.format ~= "latex" then
    return nil
  end
  local source = frame_source(raw.text)
  if not source then
    return nil
  end
  local ok, parsed = pcall(pandoc.read, source, "latex")
  return ok and parsed.blocks or nil
end

local function flatten_frame(div)
  if not div.classes:includes("frame") then
    return nil
  end
  local content = div:walk({ Para = separate_images }):walk({ Div = clean_frame_div }).content
  drop_overlay(content)
  local title, subtitle = take_frame_heading(content)
  if not title and #content == 0 then
    return {}
  end
  local blocks = pandoc.List()
  blocks:insert(title and pandoc.Header(2, title) or pandoc.HorizontalRule())
  if subtitle then
    blocks:insert(pandoc.Para({ pandoc.Emph(subtitle) }))
  end
  local sole = #content == 1 and not subtitle
  for _, block in ipairs(content) do
    if is_columns(block) and not (sole and two_columns(block)) then
      blocks:extend(unwrapped_columns(block))
    else
      blocks:insert(block)
    end
  end
  return blocks
end

local function has_frames(doc)
  local found = false
  doc:walk({
    Div = function(div)
      found = found or div.classes:includes("frame")
    end,
  })
  return found
end

local function drop_outline_headers(doc)
  if not has_frames(doc) then
    return doc
  end
  doc.blocks = doc.blocks:filter(function(block)
    return block.t ~= "Header" or block.level < 2
  end)
  return doc:walk({
    Header = function(header)
      if header.level == 2 then
        return {}
      end
    end,
  })
end

local function abstract_into_body(doc)
  local abstract = doc.meta.abstract
  if FORMAT ~= "plain" or abstract == nil then
    return
  end
  doc.meta.abstract = nil
  if pandoc.utils.type(abstract) == "Inlines" then
    abstract = pandoc.Blocks({ pandoc.Para(abstract) })
  end
  local blocks = pandoc.List()
  blocks:extend(abstract)
  blocks:extend(doc.blocks)
  doc.blocks = blocks
end

-- Entry point ------------------------------------------------------------------

function Pandoc(doc)
  if FORMAT == "pptx" then
    doc = drop_outline_headers(doc:walk({ RawBlock = parsed_frame })):walk({ Div = flatten_frame })
  end
  if exports_project_images() then
    doc = doc:walk({ Image = settle_image })
  end
  doc = doc:walk({ Div = drop_cjk_arguments })
  if SOURCE_FORMATS[FORMAT] then
    return doc
  end
  load_data()
  abstract_into_body(doc)
  mark_equation_labels(doc)
  local manual_list = has_thebibliography(doc)
  local declared = choose_bibliography(doc, manual_list)
  if manual_list and declared == 0 then
    doc = number_manual_citations(doc)
  end
  local ids = collect_identifiers(doc)
  local settled = doc:walk({
    Math = rewrite_display_math,
    Link = function(link)
      return resolve_link(link, ids)
    end,
  })
  if references_unnumbered then
    warn_export("[oleafly:references-unnumbered]")
  end
  return settled
end
