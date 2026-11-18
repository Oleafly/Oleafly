local DASHES = { [0x2010] = true, [0x2011] = true, [0x2012] = true, [0x2013] = true, [0x2014] = true, [0x2212] = true }
local SPACES = { [0xA0] = true, [0x202F] = true, [0x2009] = true }
local CONTAINERS = {
  Emph = true, Strong = true, Underline = true, Strikeout = true, SmallCaps = true,
  Superscript = true, Subscript = true, Span = true,
}

local function normal(code)
  if DASHES[code] then
    return 0x2D
  end
  if SPACES[code] then
    return 0x20
  end
  return code
end

local function codes_of(text)
  local codes = {}
  if utf8.len(text) then
    for _, code in utf8.codes(text) do
      codes[#codes + 1] = normal(code)
    end
  end
  return codes
end

local function text_of(codes, first, last)
  local characters = {}
  for index = first or 1, last or #codes do
    characters[#characters + 1] = utf8.char(codes[index])
  end
  return table.concat(characters)
end

local function shape(inlines)
  local parts = {}
  for _, inline in ipairs(inlines) do
    if inline.t == "Str" then
      parts[#parts + 1] = text_of(codes_of(inline.text))
    elseif inline.t == "Space" or inline.t == "SoftBreak" then
      parts[#parts + 1] = " "
    elseif inline.t == "RawInline" then
      parts[#parts + 1] = "<" .. inline.format .. ":" .. inline.text .. ">"
    elseif CONTAINERS[inline.t] then
      local classes = inline.t == "Span" and table.concat(inline.classes, ".") or ""
      parts[#parts + 1] = inline.t .. classes .. "(" .. shape(inline.content) .. ")"
    elseif inline.content ~= nil and inline.t ~= "Note" then
      parts[#parts + 1] = shape(inline.content)
    end
  end
  return table.concat(parts)
end

local function unescaped(text)
  return (text:gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&quot;", '"'):gsub("&amp;", "&"))
end

local function escaped(text)
  return (text:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

local function rebuilt(element, inlines)
  local copy = element:clone()
  local content = copy.content
  if #content == 1 and CONTAINERS[content[1].t] then
    copy.content = { rebuilt(content[1], inlines) }
  else
    copy.content = inlines
  end
  return { copy }
end

local function openxml_runs(raw, inlines)
  local style = raw.text:match("<w:rPr>.-</w:rPr>") or ""
  local runs = {}
  for _, inline in ipairs(inlines) do
    local text = inline.t == "Str" and inline.text or " "
    runs[#runs + 1] = "<w:r>" .. style .. '<w:t xml:space="preserve">' .. escaped(text) .. "</w:t></w:r>"
  end
  return { pandoc.RawInline("openxml", table.concat(runs)) }
end

local function opens_tex(inline)
  return inline.t == "RawInline" and inline.format:match("tex") ~= nil and inline.text:match("^\\oleafly.*{$") ~= nil
end

local function closes_tex(inline)
  return inline.t == "RawInline" and inline.format:match("tex") ~= nil and inline.text == "}"
end

local function marked_runs(suffix)
  local runs = {}
  local index = 1
  while index <= #suffix do
    local inline = suffix[index]
    if opens_tex(inline) then
      local opens, inner = {}, pandoc.Inlines({})
      while index <= #suffix and opens_tex(suffix[index]) do
        opens[#opens + 1] = suffix[index]
        index = index + 1
      end
      while index <= #suffix and not closes_tex(suffix[index]) do
        inner:insert(suffix[index])
        index = index + 1
      end
      local closes = {}
      while index <= #suffix and closes_tex(suffix[index]) and #closes < #opens do
        closes[#closes + 1] = suffix[index]
        index = index + 1
      end
      local whole = pandoc.Inlines(opens)
      whole:extend(inner)
      whole:extend(closes)
      runs[#runs + 1] = {
        text = pandoc.utils.stringify(inner),
        signature = shape(whole),
        wrap = function(inlines)
          local out = pandoc.Inlines(opens)
          out:extend(inlines)
          out:extend(closes)
          return out
        end,
      }
    else
      if CONTAINERS[inline.t] then
        runs[#runs + 1] = {
          text = pandoc.utils.stringify(inline),
          signature = shape({ inline }),
          wrap = function(inlines) return rebuilt(inline, inlines) end,
        }
      elseif inline.t == "RawInline" and inline.format == "openxml" then
        local texts = {}
        for text in inline.text:gmatch("<w:t[^>]*>([^<]*)</w:t>") do
          texts[#texts + 1] = unescaped(text)
        end
        runs[#runs + 1] = {
          text = table.concat(texts),
          signature = shape({ inline }),
          wrap = function(inlines) return openxml_runs(inline, inlines) end,
        }
      end
      index = index + 1
    end
  end
  return runs
end

local function word_character(code)
  return code ~= nil and code < 0x80 and string.char(code):match("%w") ~= nil
end

local function last_match(characters, target)
  for start = #characters - #target + 1, 1, -1 do
    local same = true
    for offset = 1, #target do
      if characters[start + offset - 1].code ~= target[offset] then
        same = false
        break
      end
    end
    local before = characters[start - 1]
    local after = characters[start + #target]
    if same and not (word_character(target[1]) and before and word_character(before.code))
      and not (word_character(target[#target]) and after and word_character(after.code)) then
      return start
    end
  end
  return nil
end

local function split_at(inline, from, to)
  if inline.t ~= "Str" then
    return nil, inline, nil
  end
  local codes = {}
  for _, code in utf8.codes(inline.text) do
    codes[#codes + 1] = code
  end
  local function piece(first, last)
    if first > last then
      return nil
    end
    return pandoc.Str(text_of(codes, first, last))
  end
  return piece(1, from - 1), piece(from, math.min(to, #codes)), piece(to + 1, #codes)
end

local function raw_depth(inline)
  if inline.t ~= "RawInline" or inline.format:match("tex") == nil then
    return 0
  end
  local _, opened = inline.text:gsub("{", "")
  local _, closed = inline.text:gsub("}", "")
  return opened - closed
end

local function wrapped_in_list(inlines, target, wrap)
  local characters = {}
  local depth = 0
  for index, inline in ipairs(inlines) do
    if depth == 0 and inline.t == "Str" and utf8.len(inline.text) then
      local position = 0
      for _, code in utf8.codes(inline.text) do
        position = position + 1
        characters[#characters + 1] = { code = normal(code), index = index, position = position }
      end
    elseif depth == 0 and (inline.t == "Space" or inline.t == "SoftBreak") then
      characters[#characters + 1] = { code = 0x20, index = index, position = 1 }
    else
      characters[#characters + 1] = { code = -1, index = index, position = 1 }
    end
    depth = depth + raw_depth(inline)
  end
  local start = last_match(characters, target)
  if start == nil then
    return nil
  end
  local first, last = characters[start], characters[start + #target - 1]
  local out, matched = pandoc.Inlines({}), pandoc.Inlines({})
  for index, inline in ipairs(inlines) do
    if index < first.index or index > last.index then
      if index > last.index and #matched > 0 then
        out:extend(wrap(matched))
        matched = pandoc.Inlines({})
      end
      out:insert(inline)
    else
      local from = index == first.index and first.position or 1
      local to = index == last.index and last.position or math.huge
      local before, middle, after = split_at(inline, from, to)
      if before then
        out:insert(before)
      end
      if middle then
        matched:insert(middle)
      end
      if after then
        out:extend(wrap(matched))
        matched = pandoc.Inlines({})
        out:insert(after)
      end
    end
  end
  if #matched > 0 then
    out:extend(wrap(matched))
  end
  return out
end

local function marked(content, target, wrap)
  local direct = wrapped_in_list(content, target, wrap)
  if direct then
    return direct, true
  end
  local done = false
  local function inside(block)
    if done then
      return nil
    end
    local found = wrapped_in_list(block.content, target, wrap)
    if found == nil then
      return nil
    end
    done = true
    block.content = found
    return block
  end
  local walked = pandoc.Inlines(content):walk({
    Note = function(note)
      note.content = note.content:walk({ Para = inside, Plain = inside })
      return note
    end,
  })
  return walked, done
end

local function candidates(text)
  local codes = codes_of(text)
  local found = { codes }
  for index = 1, #codes do
    if codes[index] == 0x20 and index < #codes then
      found[#found + 1] = table.move(codes, index + 1, #codes, 1, {})
    end
  end
  return found
end

function Cite(cite)
  local content = cite.content
  if #content == 0 then
    return nil
  end
  local changed = false
  local rendered = shape(content)
  for citation_index = #cite.citations, 1, -1 do
    local runs = marked_runs(cite.citations[citation_index].suffix)
    for run_index = #runs, 1, -1 do
      local run = runs[run_index]
      if run.text:match("%S") and not rendered:find(run.signature, 1, true) then
        for _, target in ipairs(candidates(run.text)) do
          local updated, found = marked(content, target, run.wrap)
          if found then
            content, changed = updated, true
            break
          end
        end
      end
    end
  end
  if not changed then
    return nil
  end
  cite.content = content
  return cite
end
