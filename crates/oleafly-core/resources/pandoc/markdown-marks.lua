local wrappers = {
  u = function(content) return pandoc.Underline(content) end,
  mark = function(content) return pandoc.Span(content, pandoc.Attr("", { "mark" })) end,
  sup = function(content) return pandoc.Superscript(content) end,
  sub = function(content) return pandoc.Subscript(content) end,
  strong = function(content) return pandoc.Strong(content) end,
  em = function(content) return pandoc.Emph(content) end,
  del = function(content) return pandoc.Strikeout(content) end,
}

local environments = { center = "center", right = "flushright", justify = "justify" }
local groups = {
  center = "\\centering\\let\\raggedright\\centering",
  right = "\\raggedleft\\let\\raggedright\\raggedleft",
  justify = "\\justifying\\let\\raggedright\\justifying",
}

local BASE_COLORS = {
  black = { 0, 0, 0 },
  blue = { 0, 0, 1 },
  brown = { 0.75, 0.5, 0.25 },
  cyan = { 0, 1, 1 },
  darkgray = { 0.25, 0.25, 0.25 },
  gray = { 0.5, 0.5, 0.5 },
  green = { 0, 1, 0 },
  lightgray = { 0.75, 0.75, 0.75 },
  lime = { 0.75, 1, 0 },
  magenta = { 1, 0, 1 },
  olive = { 0.5, 0.5, 0 },
  orange = { 1, 0.5, 0 },
  pink = { 1, 0.75, 0.75 },
  purple = { 0.75, 0, 0.25 },
  red = { 1, 0, 0 },
  teal = { 0, 0.5, 0.5 },
  violet = { 0.5, 0, 0.5 },
  white = { 1, 1, 1 },
  yellow = { 1, 1, 0 },
}

local SOUL_NAMES = { "hl", "ul", "st", "so", "caps" }
local DEFINERS = { "\\newcommand%*?", "\\NewDocumentCommand", "\\newrobustcmd%*?" }

local COMMON_HEADER = [[
\makeatletter
\def\oleafly@pdf{\ifdefined\texorpdfstring\expandafter\texorpdfstring\else\expandafter\@firstoftwo\fi}
\def\oleafly@rtl{\ifdefined\bbl@thetextdir\ifdefined\beginL\the\bbl@thetextdir\else0\fi\else0\fi}
\def\oleafly@either#1{#1\expandafter\@firstoftwo\else\expandafter\@secondoftwo\fi}
\makeatother]]

local MARKS_HEADER = [[
\makeatletter
\@ifpackageloaded{ulem}{}{\usepackage[normalem]{ulem}}
\let\oleafly@leaders\UL@leaders
\newif\ifoleafly@inmark
\gdef\oleafly@notes{}
\def\oleafly@number@[#1]{\oleafly@either{\ifx\relax#1\relax}{\mbox{\oleafly@savedmark}\edef\oleafly@number{\the\c@footnote}}{\mbox{\oleafly@savedmark[#1]}\def\oleafly@number{#1}}}
\def\oleafly@boxmark{\@ifnextchar[\oleafly@number@{\oleafly@number@[]}}
\def\oleafly@note@[#1]#2{\oleafly@number@[#1]\xdef\oleafly@notes{\unexpanded\expandafter{\oleafly@notes}\noexpand\footnotetext[\oleafly@number]{\unexpanded{#2}}}}
\def\oleafly@footnote{\@ifnextchar[\oleafly@note@{\oleafly@note@[]}}
\def\oleafly@decorate#1#2{\oleafly@either\ifoleafly@inmark{#1{#2}}{\begingroup\oleafly@inmarktrue\let\oleafly@savedmark\footnotemark\let\footnote\oleafly@footnote\let\footnotemark\oleafly@boxmark#1{#2}\endgroup\oleafly@notes\gdef\oleafly@notes{}}}
\def\oleafly@lrchunks{\def\UL@putbox{\ifx\UL@start\@empty\else\beginL\vrule\@width\z@\LA@penalty\@M{\UL@skip\wd\UL@box\oleafly@leaders\kern-\UL@skip}\box\UL@box\endL\fi}\def\UL@leaders{\LA@hskip\UL@skip}}
\def\oleafly@highlight{\bgroup\markoverwith{\textcolor{yellow}{\rule[-.5ex]{2pt}{2.5ex}}}\ifnum\oleafly@rtl=\@ne\oleafly@lrchunks\fi\ULon}
\DeclareRobustCommand{\oleaflyul}[1]{\oleafly@pdf{\oleafly@decorate\uline{#1}}{#1}}
\DeclareRobustCommand{\oleaflyst}[1]{\oleafly@pdf{\oleafly@decorate\sout{#1}}{#1}}
\DeclareRobustCommand{\oleaflyhl}[1]{\oleafly@pdf{\oleafly@decorate\oleafly@highlight{#1}}{#1}}
\providecommand{\ul}{\oleaflyul}
\providecommand{\st}{\oleaflyst}
\providecommand{\hl}{\oleaflyhl}
\makeatother]]

local COLOR_HEADER = [[
\newif\ifoleafly@color
\def\oleafly@trycolor#1#2#3{\oleafly@colortrue\@for\oleafly@name:=#2\do{\@ifundefinedcolor{\oleafly@name}{\oleafly@colorfalse}{}}\ifoleafly@color\colorlet{oleafly@color@#1}{#3}\fi}
\def\oleafly@fontcolor#1{\extractcolorspecs{#1}\oleafly@model\oleafly@values\convertcolorspec\oleafly@model\oleafly@values{HTML}\oleafly@hex\edef\oleafly@values{\noexpand\addfontfeatures{Color=\oleafly@hex}}\oleafly@values}
\def\oleafly@ink#1#2{\oleafly@either{\ifnum\oleafly@rtl=\@ne}{\oleafly@either{\ifdefined\addfontfeatures}{{\oleafly@fontcolor{#1}#2}}{#2}}{\textcolor{#1}{#2}}}
\DeclareRobustCommand{\oleaflycolor}[2]{\oleafly@pdf{\@ifundefinedcolor{oleafly@color@#1}{#2}{\oleafly@ink{oleafly@color@#1}{#2}}}{#2}}]]

local JUSTIFY_HEADER = "\\usepackage{ragged2e}"

local function latex()
  return FORMAT:match("latex") ~= nil or FORMAT:match("beamer") ~= nil
end

local function beamer()
  return FORMAT:match("beamer") ~= nil
end

local function tag_of(inline)
  if inline.t ~= "RawInline" or inline.format ~= "html" then
    return nil
  end
  local slash, name = inline.text:match("^<(/?)(%a+)>$")
  if name == nil then
    return nil
  end
  name = name:lower()
  if wrappers[name] == nil then
    return nil
  end
  return name, slash == "/"
end

local function pair_tags(inlines)
  local out = pandoc.List()
  local open = {}
  for _, inline in ipairs(inlines) do
    local name, closing = tag_of(inline)
    if name ~= nil and not closing then
      table.insert(open, { name = name, at = #out + 1 })
      out:insert(inline)
    elseif name ~= nil and #open > 0 and open[#open].name == name then
      local start = table.remove(open).at
      local content = pandoc.List()
      for index = start + 1, #out do
        content:insert(out[index])
      end
      for index = #out, start, -1 do
        out:remove(index)
      end
      out:insert(wrappers[name](content))
    else
      out:insert(inline)
    end
  end
  return out
end

local function is_mark(inline)
  return inline.t == "Span" and inline.classes:includes("mark")
end

local native = false

local function find_native(doc)
  doc:walk({
    Strikeout = function()
      native = true
    end,
    Underline = function()
      native = true
    end,
    Span = function(span)
      native = native or is_mark(span)
    end,
  })
  return nil
end

local function decoration_of(inline)
  if inline.t == "Underline" then
    return "underline"
  end
  if inline.t == "Strikeout" then
    return "strike"
  end
  if is_mark(inline) then
    return "highlight"
  end
  return nil
end

local function is_raw_tex(inline)
  return inline.t == "RawInline" and inline.format:match("tex") ~= nil
end

local function stands_alone(inline)
  return inline.t == "Note"
    or inline.t == "Image"
    or inline.t == "LineBreak"
    or (inline.t == "Math" and inline.mathtype == "DisplayMath")
    or (is_raw_tex(inline) and inline.text:find("\\verb", 1, true) ~= nil)
end

local function decorated(run, active)
  local content = pandoc.Inlines(run)
  if active.strike then
    content = pandoc.Inlines({ pandoc.Strikeout(content) })
  end
  if active.underline then
    content = pandoc.Inlines({ pandoc.Underline(content) })
  end
  if active.highlight then
    content = pandoc.Inlines({ pandoc.Span(content, pandoc.Attr("", { "mark" })) })
  end
  return content
end

local function with(active, decoration)
  local extended = { [decoration] = true }
  for key in pairs(active) do
    extended[key] = true
  end
  return extended
end

local function flatten(inlines, active)
  local out = pandoc.Inlines({})
  local run = pandoc.Inlines({})
  local function flush()
    if #run > 0 then
      out:extend(decorated(run, active))
      run = pandoc.Inlines({})
    end
  end
  for _, inline in ipairs(inlines) do
    local decoration = decoration_of(inline)
    if decoration ~= nil then
      flush()
      local content = flatten(inline.content, with(active, decoration))
      if inline.t == "Span" then
        local classes = inline.classes:filter(function(class) return class ~= "mark" end)
        if inline.identifier == "" and #classes == 0 and #inline.attributes == 0 then
          out:extend(content)
        else
          out:insert(pandoc.Span(content, pandoc.Attr(inline.identifier, classes, inline.attributes)))
        end
      else
        out:extend(content)
      end
    elseif stands_alone(inline) then
      flush()
      out:insert(inline)
    elseif next(active) ~= nil and (inline.t == "Superscript" or inline.t == "Subscript") then
      inline.content = flatten(inline.content, {})
      run:insert(inline)
    elseif inline.content ~= nil and inline.t ~= "Cite" then
      flush()
      if next(active) ~= nil and inline.t == "Span" and inline.attributes["data-text-color"] ~= nil then
        inline.attributes["data-oleafly-ink"] = "text"
      end
      inline.content = flatten(inline.content, active)
      out:insert(inline)
    elseif next(active) == nil then
      out:insert(inline)
    else
      run:insert(inline)
    end
  end
  flush()
  return out
end

local function number_in(text, low, high)
  local value = tonumber(text)
  return value ~= nil and text:match("^%d*%.?%d+$") ~= nil and value >= low and value <= high
end

local function numbers(text, count, low, high)
  local parts = {}
  for part in (text .. ","):gmatch("([^,]*),") do
    parts[#parts + 1] = part
  end
  if #parts ~= count then
    return false
  end
  for _, part in ipairs(parts) do
    if not number_in(part, low, high) then
      return false
    end
  end
  return true
end

local MODELS = {
  HTML = function(value) return value:match("^%x%x%x%x%x%x$") ~= nil end,
  rgb = function(value) return numbers(value, 3, 0, 1) end,
  RGB = function(value) return numbers(value, 3, 0, 255) and not value:find("%.") end,
  gray = function(value) return numbers(value, 1, 0, 1) end,
  cmyk = function(value) return numbers(value, 4, 0, 1) end,
}

local function color_names(spec)
  local names = { spec:match("^(%a%w*)") }
  if names[1] == nil then
    return nil
  end
  local rest = spec:sub(#names[1] + 1)
  while rest ~= "" do
    local percent, name, after = rest:match("^!(%d+%.?%d*)!(%a%w*)(.*)$")
    if percent == nil then
      percent, after = rest:match("^!(%d+%.?%d*)(.*)$")
      if percent == nil or after ~= "" then
        return nil
      end
    else
      names[#names + 1] = name
    end
    if tonumber(percent) > 100 then
      return nil
    end
    rest = after
  end
  return names
end

local function color_definition(spec, needs)
  local model, value = spec:match("^%[(%a+)%]%s*{([^{}]*)}$")
  if model ~= nil then
    value = value:gsub("%s", "")
    if MODELS[model] == nil or not MODELS[model](value) then
      return nil
    end
    return function(index)
      return "\\definecolor{oleafly@color@" .. index .. "}{" .. model .. "}{" .. value .. "}"
    end
  end
  local names = color_names(spec)
  if names == nil then
    return nil
  end
  local known = true
  for _, name in ipairs(names) do
    known = known and BASE_COLORS[name] ~= nil
  end
  if known then
    return function(index)
      return "\\colorlet{oleafly@color@" .. index .. "}{" .. spec .. "}"
    end
  end
  needs.dvipsnames = true
  return function(index)
    return "\\AtBeginDocument{\\oleafly@trycolor{" .. index .. "}{" .. table.concat(names, ",") .. "}{" .. spec .. "}}"
  end
end

local function color_index(spec, needs)
  local known = needs.color_of[spec]
  if known ~= nil then
    return known
  end
  local definition = color_definition(spec, needs)
  if definition == nil then
    return nil
  end
  local index = #needs.colors + 1
  needs.colors[index] = definition(index)
  needs.color_of[spec] = index
  return index
end

local function raw(text)
  return pandoc.RawInline("latex", text)
end

local function wrapped(opening, content)
  local out = pandoc.Inlines({ raw(opening) })
  out:extend(content)
  out:insert(raw("}"))
  return out
end

local INK_LEAVES = { Str = true, Code = true, Math = true, Cite = true }

local function inked(content, opening)
  local out = pandoc.Inlines({})
  for _, inline in ipairs(content) do
    if INK_LEAVES[inline.t] then
      out:extend(wrapped(opening, { inline }))
    elseif inline.content ~= nil and inline.t ~= "Note" then
      inline.content = inked(inline.content, opening)
      out:insert(inline)
    else
      out:insert(inline)
    end
  end
  return out
end

local function span_for_latex(span, needs)
  local content = span.content
  local changed = false
  if is_mark(span) then
    needs.marks = true
    content = wrapped("\\oleaflyhl{", content)
    span.classes = span.classes:filter(function(class) return class ~= "mark" end)
    changed = true
  end
  local ink = span.attributes["data-oleafly-ink"] ~= nil
  span.attributes["data-oleafly-ink"] = nil
  local spec = span.attributes["data-text-color"]
  local index = spec and color_index(spec, needs)
  if index ~= nil then
    local opening = "\\oleaflycolor{" .. index .. "}{"
    content = ink and inked(content, opening) or wrapped(opening, content)
    changed = true
  end
  if not changed then
    return nil
  end
  if span.identifier == "" and #span.classes == 0 and (index ~= nil or #span.attributes == 0) then
    return content
  end
  span.content = content
  return span
end

local function holds(block, types)
  if types[block.t] then
    return true
  end
  local found = false
  local probe = {}
  for name in pairs(types) do
    probe[name] = function()
      found = true
    end
  end
  pandoc.Blocks({ block }):walk(probe)
  return found
end

local HEADINGS = { Header = true }
local SLIDE_BREAKS = { Header = true, HorizontalRule = true }

local function aligned(content, alignment)
  local environment = environments[alignment]
  local blocks = pandoc.Blocks({})
  local pending = pandoc.Blocks({})
  local function flush()
    if #pending > 0 then
      blocks:insert(pandoc.RawBlock("latex", "\\begin{" .. environment .. "}"))
      blocks:extend(pending)
      blocks:insert(pandoc.RawBlock("latex", "\\end{" .. environment .. "}"))
      pending = pandoc.Blocks({})
    end
  end
  for _, block in ipairs(content) do
    if beamer() and holds(block, SLIDE_BREAKS) then
      flush()
      blocks:insert(block)
    elseif not beamer() and holds(block, HEADINGS) then
      flush()
      blocks:insert(pandoc.Div({
        pandoc.RawBlock("latex", "{" .. groups[alignment]),
        block,
        pandoc.RawBlock("latex", "\\csname if@noskipsec\\endcsname\\leavevmode\\fi\\par}"),
      }))
    else
      pending:insert(block)
    end
  end
  flush()
  return blocks
end

local function alignment_of(div)
  local alignment
  local classes = pandoc.List()
  for _, class in ipairs(div.classes) do
    if environments[class] ~= nil then
      alignment = alignment or class
    else
      classes:insert(class)
    end
  end
  return alignment, classes
end

local function settled(div, classes)
  if div.identifier == "" and #classes == 0 and #div.attributes == 0 then
    return div.content
  end
  div.classes = classes
  return div
end

local function justified_inside(content, needs)
  return content:walk({
    Div = function(inner)
      local alignment, classes = alignment_of(inner)
      if alignment ~= "justify" then
        return nil
      end
      needs.justify = true
      inner.content = aligned(inner.content, alignment)
      return settled(inner, classes)
    end,
  })
end

local function align(div, needs)
  local alignment, classes = alignment_of(div)
  if alignment == nil or (alignment == "justify" and not beamer()) then
    return nil
  end
  needs.justify = needs.justify or alignment == "justify"
  if beamer() and classes:includes("columns") then
    for _, column in ipairs(div.content) do
      if column.t == "Div" then
        column.content = aligned(column.content, alignment)
      end
    end
  else
    if not beamer() then
      div.content = justified_inside(div.content, needs)
    end
    div.content = aligned(div.content, alignment)
  end
  return settled(div, classes)
end

local function header_text(meta)
  local value = meta["header-includes"]
  if value == nil then
    return ""
  end
  local parts = { pandoc.utils.stringify(value) }
  local function collect(element)
    parts[#parts + 1] = element.text
  end
  pandoc.Pandoc({}, { probe = value }):walk({ RawBlock = collect, RawInline = collect })
  return table.concat(parts, "\n")
end

local function defines_soul_name(text)
  for _, name in ipairs(SOUL_NAMES) do
    for _, definer in ipairs(DEFINERS) do
      if text:find(definer .. "%s*{?%s*\\" .. name .. "%f[^%a]") then
        return true
      end
    end
  end
  return false
end

local function include(meta, code, first)
  local includes = meta["header-includes"]
  if includes == nil then
    includes = pandoc.MetaList({})
  elseif pandoc.utils.type(includes) ~= "List" then
    includes = pandoc.MetaList({ includes })
  end
  includes:insert(first and 1 or #includes + 1, pandoc.MetaBlocks({ pandoc.RawBlock("latex", code) }))
  meta["header-includes"] = includes
end

local function add_class_option(meta, option)
  local options = meta.classoption
  if options == nil then
    options = pandoc.MetaList({})
  elseif pandoc.utils.type(options) ~= "List" then
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

local function shape_for_latex(doc)
  local preamble = header_text(doc.meta)
  doc = doc:walk({
    Inlines = function(inlines)
      return flatten(inlines, {})
    end,
  })
  local needs = { colors = {}, color_of = {} }
  doc = doc:walk({
    Underline = function(underline)
      needs.marks = true
      return wrapped("\\oleaflyul{", underline.content)
    end,
    Strikeout = function(strikeout)
      needs.marks = true
      return wrapped("\\oleaflyst{", strikeout.content)
    end,
    Span = function(span)
      return span_for_latex(span, needs)
    end,
    Div = function(div)
      return align(div, needs)
    end,
  })
  if native and not defines_soul_name(preamble) and not preamble:find("%f[%a]soul%f[^%a]") then
    include(doc.meta, "\\usepackage{soul}", true)
  end
  if needs.marks or #needs.colors > 0 then
    include(doc.meta, COMMON_HEADER)
  end
  if needs.marks then
    include(doc.meta, MARKS_HEADER)
  end
  if #needs.colors > 0 then
    if needs.dvipsnames then
      add_class_option(doc.meta, "dvipsnames")
    end
    include(doc.meta, "\\makeatletter\n" .. COLOR_HEADER .. "\n" .. table.concat(needs.colors, "\n") .. "\n\\makeatother")
  end
  if needs.justify then
    include(doc.meta, JUSTIFY_HEADER)
  end
  return doc
end

local function mixed_rgb(spec)
  local first, rest = spec:match("^(%a+)(.*)$")
  local base = first and BASE_COLORS[first]
  if base == nil then
    return nil
  end
  local color = { base[1], base[2], base[3] }
  while rest ~= "" do
    local percent, name, after = rest:match("^!(%d+%.?%d*)!(%a+)(.*)$")
    if percent == nil then
      name = "white"
      percent, after = rest:match("^!(%d+%.?%d*)(.*)$")
      if percent == nil or after ~= "" then
        return nil
      end
    end
    local other = BASE_COLORS[name]
    local share = tonumber(percent) / 100
    if other == nil or share > 1 then
      return nil
    end
    for channel = 1, 3 do
      color[channel] = color[channel] * share + other[channel] * (1 - share)
    end
    rest = after
  end
  return color
end

local function model_rgb(model, value)
  local parts = {}
  for part in value:gmatch("[^,]+") do
    parts[#parts + 1] = tonumber(part)
  end
  if model == "HTML" then
    return { tonumber(value:sub(1, 2), 16) / 255, tonumber(value:sub(3, 4), 16) / 255, tonumber(value:sub(5, 6), 16) / 255 }
  end
  if model == "RGB" then
    return { parts[1] / 255, parts[2] / 255, parts[3] / 255 }
  end
  if model == "gray" then
    return { parts[1], parts[1], parts[1] }
  end
  if model == "cmyk" then
    local key = 1 - parts[4]
    return { (1 - parts[1]) * key, (1 - parts[2]) * key, (1 - parts[3]) * key }
  end
  return parts
end

local function hex_of(span)
  local spec = span.attributes["data-text-color"]
  if spec == nil then
    return nil
  end
  local style = ";" .. (span.attributes.style or "")
  local red, green, blue = style:match(";%s*color:%s*rgb%(%s*(%d+)%s*,%s*(%d+)%s*,%s*(%d+)%s*%)")
  local color
  if red ~= nil then
    color = { tonumber(red) / 255, tonumber(green) / 255, tonumber(blue) / 255 }
  else
    local model, value = spec:match("^%[(%a+)%]%s*{([^{}]*)}$")
    if model == nil then
      color = mixed_rgb(spec)
    else
      value = value:gsub("%s", "")
      if MODELS[model] ~= nil and MODELS[model](value) then
        color = model_rgb(model, value)
      end
    end
  end
  if color == nil then
    return nil
  end
  local channels = {}
  for channel = 1, 3 do
    channels[channel] = math.floor(math.max(0, math.min(1, color[channel])) * 255 + 0.5)
  end
  return string.format("%02x%02x%02x", channels[1], channels[2], channels[3])
end

local function without_color(span, content)
  if span.identifier == "" and #span.classes == 0 then
    return content
  end
  span.content = content
  span.attributes["data-text-color"] = nil
  return span
end

local TYPST_ALIGNMENT = { center = "#align(center)[", right = "#align(right)[", justify = "#[\n#set par(justify: true)" }

local function shape_for_typst(doc)
  return doc:walk({
    Span = function(span)
      local hex = hex_of(span)
      if hex == nil then
        return nil
      end
      local content = pandoc.Inlines({ pandoc.RawInline("typst", '#text(fill: rgb("#' .. hex .. '"))[') })
      content:extend(span.content)
      content:insert(pandoc.RawInline("typst", "];"))
      return without_color(span, content)
    end,
    Div = function(div)
      local alignment, classes = alignment_of(div)
      if alignment == nil then
        return nil
      end
      local content = pandoc.Blocks({ pandoc.RawBlock("typst", TYPST_ALIGNMENT[alignment]) })
      content:extend(div.content)
      content:insert(pandoc.RawBlock("typst", "]"))
      div.content = content
      return settled(div, classes)
    end,
  })
end

local DOCX_PROPERTY_ORDER = { "b", "i", "smallCaps", "strike", "color", "highlight", "u", "vertAlign" }
local DOCX_PROPERTIES = {
  b = "<w:b/><w:bCs/>",
  i = "<w:i/><w:iCs/>",
  smallCaps = "<w:smallCaps/>",
  strike = "<w:strike/>",
  highlight = '<w:highlight w:val="yellow"/>',
  u = '<w:u w:val="single"/>',
}
local DOCX_CONTAINERS = {
  Strong = { "b" },
  Emph = { "i" },
  SmallCaps = { "smallCaps" },
  Strikeout = { "strike" },
  Underline = { "u" },
  Superscript = { "vertAlign", '<w:vertAlign w:val="superscript"/>' },
  Subscript = { "vertAlign", '<w:vertAlign w:val="subscript"/>' },
}

local function escaped(text)
  return (text:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

local function docx_run(properties, text)
  local parts = {}
  for _, name in ipairs(DOCX_PROPERTY_ORDER) do
    local value = properties[name]
    if value ~= nil then
      parts[#parts + 1] = value == true and DOCX_PROPERTIES[name] or value
    end
  end
  local style = #parts > 0 and "<w:rPr>" .. table.concat(parts) .. "</w:rPr>" or ""
  return "<w:r>" .. style .. '<w:t xml:space="preserve">' .. escaped(text) .. "</w:t></w:r>"
end

local function extended(properties, name, value)
  local copy = {}
  for key, existing in pairs(properties) do
    copy[key] = existing
  end
  copy[name] = value
  return copy
end

local function docx_runs(inlines, properties, out)
  for _, inline in ipairs(inlines) do
    local container = DOCX_CONTAINERS[inline.t]
    if inline.t == "Str" then
      out[#out + 1] = docx_run(properties, inline.text)
    elseif inline.t == "Space" or inline.t == "SoftBreak" then
      out[#out + 1] = docx_run(properties, " ")
    elseif container ~= nil then
      if not docx_runs(inline.content, extended(properties, container[1], container[2] or true), out) then
        return false
      end
    elseif inline.t == "Span" and inline.identifier == "" then
      local inner = properties
      if is_mark(inline) then
        inner = extended(inner, "highlight", true)
      end
      local hex = hex_of(inline)
      if hex ~= nil then
        inner = extended(inner, "color", '<w:color w:val="' .. hex:upper() .. '"/>')
      end
      if not docx_runs(inline.content, inner, out) then
        return false
      end
    else
      return false
    end
  end
  return true
end

local function docx_colored(inlines, properties)
  local out = pandoc.Inlines({})
  for _, inline in ipairs(inlines) do
    local container = DOCX_CONTAINERS[inline.t]
    local hex = inline.t == "Span" and hex_of(inline)
    local runs = {}
    if hex and docx_runs({ inline }, properties, runs) then
      out:insert(pandoc.RawInline("openxml", table.concat(runs)))
    elseif container ~= nil then
      inline.content = docx_colored(inline.content, extended(properties, container[1], container[2] or true))
      out:insert(inline)
    elseif is_mark(inline) then
      inline.content = docx_colored(inline.content, extended(properties, "highlight", true))
      out:insert(inline)
    elseif inline.content ~= nil and inline.t ~= "Note" and inline.t ~= "Cite" then
      inline.content = docx_colored(inline.content, properties)
      out:insert(inline)
    else
      out:insert(inline)
    end
  end
  return out
end

local DOCX_ALIGNMENT = { center = "center", right = "right", justify = "both" }

local function docx_paragraph(block, alignment)
  if block.t ~= "Para" and block.t ~= "Plain" then
    return nil
  end
  local runs = {}
  if not docx_runs(block.content, {}, runs) then
    return nil
  end
  return pandoc.RawBlock(
    "openxml",
    '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:jc w:val="' .. DOCX_ALIGNMENT[alignment] .. '"/></w:pPr>' .. table.concat(runs) .. "</w:p>"
  )
end

local function shape_for_docx(doc)
  doc = doc:walk({
    Div = function(div)
      local alignment, classes = alignment_of(div)
      if alignment == nil then
        return nil
      end
      for index, block in ipairs(div.content) do
        div.content[index] = docx_paragraph(block, alignment) or block
      end
      return settled(div, classes)
    end,
  })
  return doc:walk({
    traverse = "topdown",
    Inlines = function(inlines)
      return docx_colored(inlines, {})
    end,
  })
end

return {
  {
    Pandoc = function(doc)
      if latex() then
        find_native(doc)
      end
      return nil
    end,
  },
  { Inlines = pair_tags },
  {
    Pandoc = function(doc)
      if latex() then
        return shape_for_latex(doc)
      end
      if FORMAT == "typst" then
        return shape_for_typst(doc)
      end
      if FORMAT == "docx" then
        return shape_for_docx(doc)
      end
      return nil
    end,
  },
}
