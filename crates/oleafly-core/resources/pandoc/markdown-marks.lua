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
\@ifpackageloaded{xeCJK}{\@ifpackageloaded{xeCJKfntef}{}{\usepackage{xeCJKfntef}}}{}
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
\def\oleafly@layer@h{\rlap{\textcolor{yellow}{\rule[-.5ex]{2pt}{2.5ex}}}}
\def\oleafly@layer@u{\rlap{\rule[-\ULdepth]{2pt}{\ULthickness}}}
\def\oleafly@layer@s{\rlap{\rule[.55ex]{2pt}{\ULthickness}}}
\def\oleafly@layers#1{\ifx\relax#1\else\csname oleafly@layer@#1\endcsname\expandafter\oleafly@layers\fi}
\def\oleafly@marks#1{\bgroup\UL@setULdepth\markoverwith{\hbox to 2pt{\oleafly@layers#1\relax\hss}}\in@{h}{#1}\ifin@\ifnum\oleafly@rtl=\@ne\oleafly@lrchunks\fi\fi\ULon}
\DeclareRobustCommand{\oleaflyul}[1]{\oleafly@pdf{\oleafly@decorate\uline{#1}}{#1}}
\DeclareRobustCommand{\oleaflyst}[1]{\oleafly@pdf{\oleafly@decorate\sout{#1}}{#1}}
\DeclareRobustCommand{\oleaflyhl}[1]{\oleafly@pdf{\oleafly@decorate{\oleafly@marks{h}}{#1}}{#1}}
\DeclareRobustCommand{\oleaflymarks}[2]{\oleafly@pdf{\oleafly@decorate{\oleafly@marks{#1}}{#2}}{#2}}
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

local ITEM_HEADER = [[
\makeatletter
\newtoks\oleafly@toks
\def\oleaflypinlabel{\oleafly@toks\expandafter{\the\everypar}\edef\oleafly@everypar{\noexpand\everypar{\noexpand\hskip\z@\noexpand\@plus-1fil\relax\the\oleafly@toks\noexpand\hskip\z@\noexpand\@plus1fil\relax}}\oleafly@everypar}
\makeatother]]

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

local QUOTE_MARKS = { DoubleQuote = { "“", "”" }, SingleQuote = { "‘", "’" } }

local function holds_tag(inlines)
  for _, inline in ipairs(inlines) do
    if tag_of(inline) ~= nil then
      return true
    end
  end
  return false
end

local function unquoted(inlines, wanted)
  local out = pandoc.List()
  for _, inline in ipairs(inlines) do
    if inline.t == "Quoted" and (wanted == nil or wanted(inline.content)) then
      local marks = QUOTE_MARKS[inline.quotetype]
      out:insert(pandoc.Str(marks[1]))
      out:extend(unquoted(inline.content, wanted))
      out:insert(pandoc.Str(marks[2]))
    else
      out:insert(inline)
    end
  end
  return out
end

local function pair_tags(inlines)
  local out = pandoc.List()
  local open = {}
  for _, inline in ipairs(unquoted(inlines, holds_tag)) do
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

local LAYERS = { h = "highlight", u = "underline", s = "strike" }

local function decorations_of(inline)
  if inline.t == "Underline" then
    return { underline = true }
  end
  if inline.t == "Strikeout" then
    return { strike = true }
  end
  if is_mark(inline) then
    return { highlight = true }
  end
  local layers = inline.t == "Span" and inline.attributes["data-oleafly-marks"]
  if layers then
    local found = {}
    for letter in layers:gmatch(".") do
      found[LAYERS[letter]] = true
    end
    return found
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
  local layers = (active.highlight and "h" or "") .. (active.underline and "u" or "") .. (active.strike and "s" or "")
  return pandoc.Inlines({ pandoc.Span(pandoc.Inlines(run), pandoc.Attr("", {}, { ["data-oleafly-marks"] = layers })) })
end

local function with(active, decorations)
  local extended = {}
  for key in pairs(active) do
    extended[key] = true
  end
  for key in pairs(decorations) do
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
  if next(active) ~= nil then
    inlines = unquoted(inlines)
  end
  for _, inline in ipairs(inlines) do
    local decorations = decorations_of(inline)
    if decorations ~= nil then
      flush()
      local content = flatten(inline.content, with(active, decorations))
      if inline.t == "Span" and inline.attributes["data-oleafly-marks"] == nil then
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

local URL_BREAKS = { ["/"] = true, ["."] = true, ["-"] = true, ["_"] = true, ["?"] = true, ["&"] = true, ["="] = true, ["#"] = true }
local CJK_RANGES = { 0x2E80, 0x9FFF, 0xF900, 0xFAFF, 0xFE30, 0xFE4F, 0xFF00, 0xFFEF, 0x20000, 0x3FFFF }
local CJK_STAYS_AFTER = "、。，．・：；？！ー」』）】〕〉》〗〙〛］｝〟’”…‥ゝゞヽヾ々〻ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ％゛゜"
local CJK_STAYS_BEFORE = "「『（【〔〈《〖〘〚［｛〝‘“"

local function thai(code)
  return code >= 0xE01 and code <= 0xE5B
end

local function thai_follows(code)
  return code == 0xE2F or (code >= 0xE30 and code <= 0xE3A) or code == 0xE45 or code == 0xE46 or (code >= 0xE47 and code <= 0xE4E)
end

local function in_ranges(ranges, code)
  for index = 1, #ranges, 2 do
    if code >= ranges[index] and code <= ranges[index + 1] then
      return true
    end
  end
  return false
end

local function breaks_before(previous, code, url, characters)
  if thai(previous) and thai(code) then
    return not thai_follows(code) and not (previous >= 0xE40 and previous <= 0xE44)
  end
  if characters and in_ranges(CJK_RANGES, previous) and in_ranges(CJK_RANGES, code) then
    return not CJK_STAYS_AFTER:find(utf8.char(code), 1, true) and not CJK_STAYS_BEFORE:find(utf8.char(previous), 1, true)
  end
  return url and URL_BREAKS[utf8.char(previous)] ~= nil and URL_BREAKS[utf8.char(code)] == nil
end

local function pieces_of(text, characters)
  if not utf8.len(text) then
    return { text }
  end
  local url = utf8.len(text) >= 20 and text:find("/", 1, true) ~= nil
  local pieces, piece, previous = {}, {}, nil
  for _, code in utf8.codes(text) do
    if previous ~= nil and breaks_before(previous, code, url, characters) then
      pieces[#pieces + 1] = table.concat(piece)
      piece = {}
    end
    piece[#piece + 1] = utf8.char(code)
    previous = code
  end
  pieces[#pieces + 1] = table.concat(piece)
  return pieces
end

local function broken(text, characters, each)
  local out = pandoc.Inlines({})
  for index, piece in ipairs(pieces_of(text, characters)) do
    if index > 1 then
      out:insert(raw("\\allowbreak{}"))
    end
    out:extend(each(pandoc.Str(piece)))
  end
  return out
end

local function breakable(content)
  local out = pandoc.Inlines({})
  for _, inline in ipairs(content) do
    if inline.t == "Str" then
      out:extend(broken(inline.text, false, function(piece) return { piece } end))
    else
      out:insert(inline)
    end
  end
  return out
end

local INK_LEAVES = { Code = true, Math = true, Cite = true }

local function inked(content, opening)
  local out = pandoc.Inlines({})
  for _, inline in ipairs(content) do
    if inline.t == "Str" then
      out:extend(broken(inline.text, true, function(piece) return wrapped(opening, { piece }) end))
    elseif INK_LEAVES[inline.t] then
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

local MARK_COMMANDS = { h = "\\oleaflyhl{", u = "\\oleaflyul{", s = "\\oleaflyst{" }

local function span_for_latex(span, needs)
  local content = span.content
  local changed = false
  local layers = span.attributes["data-oleafly-marks"]
  if layers ~= nil then
    needs.marks = true
    span.attributes["data-oleafly-marks"] = nil
    content = wrapped(MARK_COMMANDS[layers] or "\\oleaflymarks{" .. layers .. "}{", breakable(content))
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
local LISTS = { BulletList = true, OrderedList = true }
local TEXT_BLOCKS = { Plain = true, Para = true }

local in_item

local function items_aligned(block, alignment, needs)
  if beamer() or not LISTS[block.t] then
    return block
  end
  local items = pandoc.List()
  for _, item in ipairs(block.content) do
    items:insert(in_item(item, alignment, needs))
  end
  block.content = items
  return block
end

in_item = function(content, alignment, needs)
  local opening = "{" .. groups[alignment]
  if alignment == "justify" then
    needs.justify = true
  else
    needs.pin = true
    opening = opening .. "\\oleaflypinlabel"
  end
  local blocks = pandoc.Blocks({})
  for _, block in ipairs(content) do
    blocks:insert(items_aligned(block, alignment, needs))
  end
  local first, last = blocks[1], blocks[#blocks]
  if first ~= nil and TEXT_BLOCKS[first.t] then
    local inlines = first.content
    inlines:insert(1, raw(opening .. "{}"))
    first.content = inlines
  else
    blocks:insert(1, pandoc.RawBlock("latex", opening))
  end
  if last ~= nil and TEXT_BLOCKS[last.t] then
    local inlines = last.content
    inlines:insert(raw("\\par}"))
    last.content = inlines
  else
    blocks:insert(pandoc.RawBlock("latex", "\\par}"))
  end
  return blocks
end

local function aligned(content, alignment, needs)
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
      pending:insert(items_aligned(block, alignment, needs))
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
      inner.content = aligned(inner.content, alignment, needs)
      return settled(inner, classes)
    end,
  })
end

local function align(div, needs)
  local alignment, classes = alignment_of(div)
  local item = div.attributes["data-oleafly-item"] ~= nil
  div.attributes["data-oleafly-item"] = nil
  if alignment == nil or (alignment == "justify" and not beamer() and not item) then
    return item and div or nil
  end
  needs.justify = needs.justify or alignment == "justify"
  if beamer() and classes:includes("columns") then
    for _, column in ipairs(div.content) do
      if column.t == "Div" then
        column.content = aligned(column.content, alignment, needs)
      end
    end
  elseif item and not beamer() then
    div.content = in_item(justified_inside(div.content, needs), alignment, needs)
  else
    if not beamer() then
      div.content = justified_inside(div.content, needs)
    end
    div.content = aligned(div.content, alignment, needs)
  end
  return settled(div, classes)
end

local function mark_item_divs(list)
  local items = list.content
  for _, item in ipairs(items) do
    for _, block in ipairs(item) do
      if block.t == "Div" and alignment_of(block) ~= nil then
        block.attributes["data-oleafly-item"] = "1"
      end
    end
  end
  list.content = items
  return list
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
  local generated = pandoc.Div({ pandoc.RawBlock("latex", code) }, pandoc.Attr("", { "oleafly-generated" }))
  includes:insert(first and 1 or #includes + 1, pandoc.MetaBlocks({ generated }))
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

local ZWJ = utf8.char(0x200D)
local ARABIC_LETTERS = { 0x0620, 0x064A, 0x066E, 0x06D3, 0x06D5, 0x06D5, 0x06EE, 0x06EF, 0x06FA, 0x06FF, 0x0750, 0x077F, 0x08A0, 0x08C9 }
local ARABIC_MARKS = {
  0x0610, 0x061A, 0x064B, 0x065F, 0x0670, 0x0670, 0x06D6, 0x06DC, 0x06DF, 0x06E4, 0x06E7, 0x06E8,
  0x06EA, 0x06ED, 0x08CA, 0x08E1, 0x08E3, 0x08FF,
}
local ARABIC_RIGHT_JOINING = {
  0x0622, 0x0625, 0x0627, 0x0627, 0x0629, 0x0629, 0x062F, 0x0632, 0x0648, 0x0648, 0x0671, 0x0673,
  0x0675, 0x0677, 0x0688, 0x0699, 0x06C0, 0x06C0, 0x06C3, 0x06CB, 0x06CD, 0x06CD, 0x06CF, 0x06CF,
  0x06D2, 0x06D3, 0x06D5, 0x06D5, 0x06EE, 0x06EF, 0x0759, 0x075B, 0x076B, 0x076C, 0x0771, 0x0771,
  0x0773, 0x0774, 0x0778, 0x0779, 0x08AA, 0x08AC, 0x08AE, 0x08AE, 0x08B1, 0x08B2, 0x08B9, 0x08B9,
}
local ARABIC_NON_JOINING = { [0x0621] = true, [0x0674] = true, [0x06FD] = true, [0x06FE] = true }

local function joining_type(code)
  if in_ranges(ARABIC_MARKS, code) then
    return "mark"
  end
  if not in_ranges(ARABIC_LETTERS, code) or ARABIC_NON_JOINING[code] then
    return nil
  end
  return in_ranges(ARABIC_RIGHT_JOINING, code) and "right" or "dual"
end

local function edge_text(inline, at_end)
  if inline.t == "Str" then
    return inline.text
  end
  if inline.content == nil or inline.t == "Note" or inline.t == "Cite" or inline.t == "Image" or #inline.content == 0 then
    return nil
  end
  return edge_text(inline.content[at_end and #inline.content or 1], at_end)
end

local function edge_joining(text, at_end)
  if text == nil or not utf8.len(text) then
    return nil
  end
  local found
  for _, code in utf8.codes(text) do
    local kind = joining_type(code)
    if kind ~= "mark" then
      if not at_end then
        return kind
      end
      found = kind
    end
  end
  return found
end

local function with_joiner(inline, at_end)
  if inline.t == "Str" then
    inline.text = at_end and inline.text .. ZWJ or ZWJ .. inline.text
    return inline
  end
  local content = inline.content
  local index = at_end and #content or 1
  content[index] = with_joiner(content[index], at_end)
  inline.content = content
  return inline
end

local function joined_across_marks(inlines)
  for index = 2, #inlines do
    local before, after = inlines[index - 1], inlines[index]
    if before.t ~= "Str" or after.t ~= "Str" then
      local left = edge_joining(edge_text(before, true), true)
      local right = edge_joining(edge_text(after, false), false)
      if left == "dual" and right ~= nil then
        inlines[index - 1] = with_joiner(before, true)
        inlines[index] = with_joiner(after, false)
      end
    end
  end
  return inlines
end

local function shape_for_latex(doc)
  local preamble = header_text(doc.meta)
  doc = doc:walk({ Inlines = joined_across_marks })
  doc = doc:walk({
    Inlines = function(inlines)
      return flatten(inlines, {})
    end,
  })
  doc = doc:walk({ BulletList = mark_item_divs, OrderedList = mark_item_divs })
  local needs = { colors = {}, color_of = {} }
  doc = doc:walk({
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
  if needs.pin then
    include(doc.meta, ITEM_HEADER)
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

local TYPST_ALIGNMENT = {
  center = { "#block(width: 100%)[#align(center)[", "]]" },
  right = { "#block(width: 100%)[#align(right)[", "]]" },
  justify = { "#block(width: 100%)[\n#set par(justify: true)", "]" },
}

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
      local shape = TYPST_ALIGNMENT[alignment]
      local content = pandoc.Blocks({ pandoc.RawBlock("typst", shape[1]) })
      content:extend(div.content)
      content:insert(pandoc.RawBlock("typst", shape[2]))
      div.content = content
      return settled(div, classes)
    end,
  })
end

local DOCX_PROPERTY_ORDER = { "style", "b", "i", "smallCaps", "strike", "color", "highlight", "u", "vertAlign", "rtl" }
local DOCX_PROPERTIES = {
  b = "<w:b/><w:bCs/>",
  i = "<w:i/><w:iCs/>",
  smallCaps = "<w:smallCaps/>",
  strike = "<w:strike/>",
  highlight = '<w:highlight w:val="yellow"/>',
  u = '<w:u w:val="single"/>',
  rtl = "<w:rtl/>",
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
local DOCX_SPAN_ATTRIBUTES = { ["data-text-color"] = true, style = true, ["custom-style"] = true, dir = true }
local DOCX_ALIGNMENT = { center = "center", right = "right", justify = "both" }
local DOCX_LIST_BASE = 1000

local function escaped(text)
  return (text:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

local function docx_run(properties, body)
  local parts = {}
  for _, name in ipairs(DOCX_PROPERTY_ORDER) do
    local value = properties[name]
    if value ~= nil and value ~= false then
      parts[#parts + 1] = value == true and DOCX_PROPERTIES[name] or value
    end
  end
  local style = #parts > 0 and "<w:rPr>" .. table.concat(parts) .. "</w:rPr>" or ""
  return "<w:r>" .. style .. body .. "</w:r>"
end

local function docx_text(properties, text)
  return docx_run(properties, '<w:t xml:space="preserve">' .. escaped(text) .. "</w:t>")
end

local function extended(properties, name, value)
  local copy = {}
  for key, existing in pairs(properties) do
    copy[key] = existing
  end
  copy[name] = value
  return copy
end

local function style_id(name)
  return (name:gsub("%s", ""))
end

local function span_properties(span, properties, styles)
  local inner = properties
  if is_mark(span) then
    inner = extended(inner, "highlight", true)
  end
  local hex = hex_of(span)
  if hex ~= nil then
    inner = extended(inner, "color", '<w:color w:val="' .. hex:upper() .. '"/>')
  end
  local custom = span.attributes["custom-style"]
  if custom ~= nil then
    styles[custom] = true
    inner = extended(inner, "style", '<w:rStyle w:val="' .. escaped(style_id(custom)) .. '"/>')
  end
  local dir = span.attributes.dir
  if dir == "rtl" or dir == "ltr" then
    inner = extended(inner, "rtl", dir == "rtl")
  end
  return inner
end

local function plain_span(span)
  if span.identifier ~= "" then
    return false
  end
  for name in pairs(span.attributes) do
    if not DOCX_SPAN_ATTRIBUTES[name] then
      return false
    end
  end
  return true
end

local function docx_runs(inlines, properties, out, styles)
  for _, inline in ipairs(inlines) do
    local container = DOCX_CONTAINERS[inline.t]
    if inline.t == "Str" then
      out[#out + 1] = docx_text(properties, inline.text)
    elseif inline.t == "Space" or inline.t == "SoftBreak" then
      out[#out + 1] = docx_text(properties, " ")
    elseif inline.t == "LineBreak" then
      out[#out + 1] = docx_run(properties, "<w:br/>")
    elseif inline.t == "Code" then
      out[#out + 1] = docx_text(extended(properties, "style", '<w:rStyle w:val="VerbatimChar"/>'), inline.text)
    elseif inline.t == "Quoted" then
      if not docx_runs(unquoted({ inline }), properties, out, styles) then
        return false
      end
    elseif container ~= nil then
      if not docx_runs(inline.content, extended(properties, container[1], container[2] or true), out, styles) then
        return false
      end
    elseif inline.t == "Span" and plain_span(inline) then
      if not docx_runs(inline.content, span_properties(inline, properties, styles), out, styles) then
        return false
      end
    else
      return false
    end
  end
  return true
end

local function openxml(runs)
  return pandoc.RawInline("openxml", table.concat(runs))
end

local function colored_pieces(inlines, properties, styles)
  local out = pandoc.Inlines({})
  local runs = {}
  local function flush()
    if #runs > 0 then
      out:insert(openxml(runs))
      runs = {}
    end
  end
  for _, inline in ipairs(unquoted(inlines)) do
    local trial = {}
    if docx_runs({ inline }, properties, trial, styles) then
      for _, run in ipairs(trial) do
        runs[#runs + 1] = run
      end
    else
      flush()
      local container = DOCX_CONTAINERS[inline.t]
      if inline.t == "Link" then
        inline.content = colored_pieces(inline.content, extended(properties, "style", '<w:rStyle w:val="Hyperlink"/>'), styles)
      elseif container ~= nil then
        inline.content = colored_pieces(inline.content, extended(properties, container[1], container[2] or true), styles)
      elseif inline.t == "Span" then
        inline.content = colored_pieces(inline.content, span_properties(inline, properties, styles), styles)
        inline.attributes["data-text-color"] = nil
      end
      out:insert(inline)
    end
  end
  flush()
  return out
end

local function docx_colored(inlines, properties, styles)
  local out = pandoc.Inlines({})
  for _, inline in ipairs(inlines) do
    local container = DOCX_CONTAINERS[inline.t]
    if inline.t == "Span" and hex_of(inline) then
      out:extend(colored_pieces({ inline }, properties, styles))
    elseif container ~= nil then
      inline.content = docx_colored(inline.content, extended(properties, container[1], container[2] or true), styles)
      out:insert(inline)
    elseif inline.t == "Span" then
      inline.content = docx_colored(inline.content, span_properties(inline, properties, styles), styles)
      out:insert(inline)
    elseif inline.content ~= nil and inline.t ~= "Note" and inline.t ~= "Cite" then
      inline.content = docx_colored(inline.content, properties, styles)
      out:insert(inline)
    else
      out:insert(inline)
    end
  end
  return out
end

local function direction(context, element)
  local dir = element.attributes and element.attributes.dir
  if dir ~= "rtl" and dir ~= "ltr" then
    return context
  end
  return extended(context, "rtl", dir == "rtl")
end

local function numbering(context)
  local list = context.list
  if list == nil then
    return nil
  end
  local numid = list.fresh and list.numid or DOCX_LIST_BASE
  list.fresh = false
  return '<w:numPr><w:ilvl w:val="' .. list.level .. '"/><w:numId w:val="' .. numid .. '"/></w:numPr>'
end

local function docx_paragraph(block, alignment, context, state)
  if block.t ~= "Para" and block.t ~= "Plain" then
    return nil
  end
  local runs = {}
  if not docx_runs(block.content, { rtl = context.rtl }, runs, state.styles) then
    return nil
  end
  local style = "BodyText"
  if context.list then
    style = block.t == "Plain" and "Compact" or nil
  elseif context.quote then
    style = "BlockText"
  end
  local properties = { style and '<w:pStyle w:val="' .. style .. '"/>' or "", numbering(context) or "" }
  if context.rtl then
    properties[#properties + 1] = "<w:bidi/>"
  end
  if not (context.rtl and alignment == "right") then
    properties[#properties + 1] = '<w:jc w:val="' .. DOCX_ALIGNMENT[alignment] .. '"/>'
  end
  return pandoc.RawBlock("openxml", "<w:p><w:pPr>" .. table.concat(properties) .. "</w:pPr>" .. table.concat(runs) .. "</w:p>")
end

local docx_blocks

local function docx_inlines(inlines, context, state)
  local walked = pandoc.Inlines(inlines):walk({
    Note = function(note)
      note.content = docx_blocks(note.content, { rtl = state.rtl }, state)
      return note
    end,
  })
  return docx_colored(walked, { rtl = context.rtl }, state.styles)
end

local function list_number(list, state)
  if list.t == "OrderedList" and list.style == "Example" then
    if state.example == nil then
      state.lists = state.lists + 1
      state.example = DOCX_LIST_BASE + state.lists
    end
    return state.example
  end
  state.lists = state.lists + 1
  return DOCX_LIST_BASE + state.lists
end

local function docx_block(block, context, state)
  if block.t == "BulletList" or block.t == "OrderedList" then
    numbering(context)
    local numid = list_number(block, state)
    local level = context.list and context.list.level + 1 or 0
    local items = pandoc.List()
    for _, item in ipairs(block.content) do
      items:insert(docx_blocks(item, extended(context, "list", { numid = numid, level = level, fresh = true }), state))
    end
    block.content = items
    return block
  end
  if block.t == "BlockQuote" then
    block.content = docx_blocks(block.content, extended(context, "quote", true), state)
    return block
  end
  if block.t == "Div" then
    local inner = direction(context, block)
    local alignment, classes = alignment_of(block)
    if alignment == nil then
      block.content = docx_blocks(block.content, inner, state)
      return block
    end
    local content = pandoc.Blocks({})
    for _, child in ipairs(block.content) do
      content:insert(docx_paragraph(child, alignment, inner, state) or docx_block(child, inner, state))
    end
    block.content = content
    return settled(block, classes)
  end
  if block.t == "Para" or block.t == "Plain" or block.t == "Header" then
    numbering(context)
    block.content = docx_inlines(block.content, direction(context, block), state)
    return block
  end
  if block.t == "LineBlock" then
    numbering(context)
    local lines = pandoc.List()
    for _, line in ipairs(block.content) do
      lines:insert(docx_inlines(line, context, state))
    end
    block.content = lines
    return block
  end
  if block.t == "DefinitionList" then
    numbering(context)
    local items = pandoc.List()
    for _, item in ipairs(block.content) do
      local definitions = pandoc.List()
      for _, definition in ipairs(item[2]) do
        definitions:insert(docx_blocks(definition, context, state))
      end
      items:insert({ docx_inlines(item[1], context, state), definitions })
    end
    block.content = items
    return block
  end
  numbering(context)
  return block:walk({
    traverse = "topdown",
    Blocks = function(blocks)
      return docx_blocks(blocks, { rtl = context.rtl }, state), false
    end,
  })
end

docx_blocks = function(blocks, context, state)
  local out = pandoc.Blocks({})
  for _, block in ipairs(blocks) do
    local shaped = docx_block(block, context, state)
    if pandoc.utils.type(shaped) == "Blocks" or pandoc.utils.type(shaped) == "List" then
      out:extend(shaped)
    else
      out:insert(shaped)
    end
  end
  return out
end

local function registering(doc, styles)
  local names = {}
  for name in pairs(styles) do
    names[#names + 1] = name
  end
  if #names == 0 then
    return doc
  end
  table.sort(names)
  local done = false
  local function register(block)
    if done then
      return nil, false
    end
    done = true
    local inlines = block.content
    for _, name in ipairs(names) do
      inlines:insert(1, pandoc.Span({}, pandoc.Attr("", {}, { ["custom-style"] = name })))
    end
    block.content = inlines
    return block, false
  end
  return doc:walk({ traverse = "topdown", Para = register, Plain = register })
end

local function shape_for_docx(doc)
  local rtl = doc.meta.dir ~= nil and pandoc.utils.stringify(doc.meta.dir) == "rtl"
  local state = { lists = 0, rtl = rtl, styles = {} }
  local abstract = doc.meta.abstract
  if abstract ~= nil and pandoc.utils.type(abstract) == "Blocks" then
    doc.meta.abstract = docx_blocks(abstract, { rtl = rtl }, state)
  end
  doc.blocks = docx_blocks(doc.blocks, { rtl = rtl }, state)
  doc = doc:walk({
    traverse = "topdown",
    Inlines = function(inlines)
      return docx_colored(inlines, { rtl = rtl }, state.styles)
    end,
  })
  return registering(doc, state.styles)
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
