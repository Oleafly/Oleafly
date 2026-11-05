local LATIN_MODERN = {
  0x20, 0x7E, 0xA0, 0x131, 0x134, 0x137, 0x139, 0x148, 0x14A, 0x165, 0x168, 0x17F,
  0x18E, 0x18E, 0x192, 0x192, 0x1A0, 0x1A1, 0x1AF, 0x1B0, 0x1CD, 0x1D4, 0x1D7, 0x1DD,
  0x1E6, 0x1E7, 0x1EA, 0x1EB, 0x1F0, 0x1F0, 0x1F4, 0x1F5, 0x1FA, 0x201, 0x204, 0x205,
  0x208, 0x209, 0x20C, 0x20D, 0x210, 0x211, 0x214, 0x215, 0x218, 0x21B, 0x237, 0x237,
  0x258, 0x259, 0x2BE, 0x2BF, 0x2C6, 0x2C7, 0x2D8, 0x2DD, 0x300, 0x304, 0x306, 0x30C,
  0x30F, 0x30F, 0x311, 0x311, 0x323, 0x323, 0x326, 0x326, 0x32E, 0x332, 0x391, 0x3A1,
  0x3A3, 0x3A9, 0xE3F, 0xE3F, 0x1E0C, 0x1E0F, 0x1E24, 0x1E27, 0x1E2A, 0x1E2B, 0x1E2E, 0x1E2F,
  0x1E36, 0x1E39, 0x1E42, 0x1E47, 0x1E58, 0x1E5D, 0x1E62, 0x1E63, 0x1E6C, 0x1E6F,
  0x1E80, 0x1E85, 0x1E92, 0x1E93, 0x1E97, 0x1E97, 0x1EA0, 0x1EF9, 0x2010, 0x2011,
  0x2013, 0x2014, 0x2016, 0x2016, 0x2018, 0x201A, 0x201C, 0x201E, 0x2020, 0x2022,
  0x2026, 0x2026, 0x2030, 0x2030, 0x2039, 0x203B, 0x203D, 0x203D, 0x203F, 0x2040,
  0x2044, 0x2046, 0x2052, 0x2052, 0x2054, 0x2054, 0x20A1, 0x20A1, 0x20A4, 0x20A4,
  0x20A6, 0x20A6, 0x20A9, 0x20A9, 0x20AB, 0x20AC, 0x20B1, 0x20B1, 0x2103, 0x2103,
  0x2116, 0x2117, 0x211E, 0x211E, 0x2126, 0x2127, 0x212E, 0x212E, 0x2190, 0x2193,
  0x2212, 0x2212, 0x2215, 0x2215, 0x2217, 0x2217, 0x221A, 0x221A, 0x221E, 0x221E,
  0x2222, 0x2222, 0x2300, 0x2300, 0x2329, 0x232A, 0x2422, 0x2423, 0x25E6, 0x25E6,
  0x266A, 0x266A, 0x26AD, 0x26AE, 0x27E6, 0x27E7,
}

local COMPUTER_MODERN_GAPS = {
  [0x1E2E] = true, [0x1E2F] = true, [0x20B1] = true, [0x2215] = true, [0x221E] = true,
  [0x2222] = true, [0x2300] = true, [0x27E6] = true, [0x27E7] = true,
}

local WIDER_LATIN = {
  0x180, 0x36F, 0x370, 0x3FF, 0x400, 0x52F, 0x1D00, 0x1DBF, 0x1E00, 0x1FFF,
}

local SYMBOLS = { 0x2000, 0x2BFF, 0x2E00, 0x2E7F, 0xFFFC, 0xFFFD }

local INVISIBLE = {
  0x200B, 0x200F, 0x2028, 0x202F, 0x2060, 0x206F,
}

local VARIATION_SELECTORS = { 0xFE00, 0xFE0F }

local EMOJI = { 0x1F000, 0x1FAFF }

local HANGUL = {
  0x1100, 0x11FF, 0x3130, 0x318F, 0xA960, 0xA97F, 0xAC00, 0xD7FF, 0xFFA0, 0xFFDC,
}

local KANA = { 0x3040, 0x30FF, 0x31F0, 0x31FF, 0xFF65, 0xFF9F }

local HAN = {
  0x2E80, 0x2FDF, 0x3000, 0x303F, 0x3100, 0x312F, 0x31A0, 0x31EF, 0x3200, 0x4DBF,
  0x4E00, 0x9FFF, 0xF900, 0xFAFF, 0xFE30, 0xFE4F, 0xFF00, 0xFF64, 0xFFE0, 0xFFEF,
  0x20000, 0x3FFFF,
}

local TRADITIONAL_ONLY = "這們個來為時會學國說對與點開關經過還發現後實裡處從將應當產業機動"
local SIMPLIFIED_ONLY = "这们个来为时会学国说对与点开关经过还发现后实里处从将应当产业机动"

local CJK_FONTS = {
  korean = {
    main = "UnBatang.ttf",
    options = { "BoldFont=UnBatangBold.ttf", "AutoFakeSlant=0.15" },
    fallback = { "FandolSong-Regular.otf", "HaranoAjiMincho-Regular.otf", "bsmi00lp.ttf" },
  },
  japanese = {
    main = "HaranoAjiMincho-Regular.otf",
    options = { "BoldFont=HaranoAjiMincho-Bold.otf", "AutoFakeSlant=0.15" },
    fallback = { "FandolSong-Regular.otf", "bsmi00lp.ttf", "UnBatang.ttf" },
  },
  simplified = {
    main = "FandolSong-Regular.otf",
    options = { "BoldFont=FandolSong-Bold.otf", "ItalicFont=FandolKai-Regular.otf" },
    fallback = { "HaranoAjiMincho-Regular.otf", "bsmi00lp.ttf", "UnBatang.ttf" },
  },
  traditional = {
    main = "bsmi00lp.ttf",
    options = { "AutoFakeBold=2", "ItalicFont=bkai00mp.ttf" },
    fallback = { "HaranoAjiMincho-Regular.otf", "FandolSong-Regular.otf", "UnBatang.ttf" },
  },
}

local CJK_LANGUAGES = {
  ko = "korean", ja = "japanese", zh = "simplified",
  ["zh-tw"] = "traditional", ["zh-hk"] = "traditional", ["zh-mo"] = "traditional", ["zh-hant"] = "traditional",
}

local FREE_SERIF = { "FreeSerif.otf", "FreeSerifBold.otf", "FreeSerifItalic.otf", "FreeSerifBoldItalic.otf" }

local function free_serif(bold, italic, bold_italic)
  return {
    FREE_SERIF[1],
    bold and FREE_SERIF[2] or nil,
    italic and FREE_SERIF[3] or nil,
    bold_italic and FREE_SERIF[4] or nil,
  }
end

local SCRIPTS = {
  {
    name = "arabic", tag = "Arabic", lang = "ar", rtl = true, probe = 0x627,
    languages = { ar = true, fa = true, ur = true, ps = true, ckb = true, sd = true },
    ranges = { 0x600, 0x6FF, 0x750, 0x77F, 0x8A0, 0x8FF, 0xFB50, 0xFDFF, 0xFE70, 0xFEFF },
    fonts = { "Amiri-Regular.ttf", "Amiri-Bold.ttf", "Amiri-Slanted.ttf", "Amiri-BoldSlanted.ttf" },
  },
  {
    name = "hebrew", tag = "Hebrew", lang = "he", rtl = true, probe = 0x5D0,
    languages = { he = true, yi = true },
    ranges = { 0x590, 0x5FF, 0xFB1D, 0xFB4F },
    fonts = free_serif(true, true, true),
  },
  {
    name = "devanagari", tag = "Devanagari", probe = 0x905,
    ranges = { 0x900, 0x97F, 0xA8E0, 0xA8FF },
    fonts = { "Shobhika-Regular.otf", "Shobhika-Bold.otf" },
  },
  { name = "bengali", tag = "Bengali", probe = 0x985, ranges = { 0x980, 0x9FF }, fonts = free_serif(false, true, false) },
  { name = "gurmukhi", tag = "Gurmukhi", probe = 0xA05, ranges = { 0xA00, 0xA7F }, fonts = free_serif(true, false, false) },
  { name = "gujarati", tag = "Gujarati", probe = 0xA85, ranges = { 0xA80, 0xAFF }, fonts = free_serif(false, false, false) },
  { name = "tamil", tag = "Tamil", probe = 0xB85, ranges = { 0xB80, 0xBFF }, fonts = free_serif(false, false, false) },
  { name = "malayalam", tag = "Malayalam", probe = 0xD05, ranges = { 0xD00, 0xD7F }, fonts = free_serif(false, false, false) },
  { name = "sinhala", tag = "Sinhala", probe = 0xD85, ranges = { 0xD80, 0xDFF }, fonts = free_serif(true, false, false) },
  {
    name = "thai", tag = "Thai", probe = 0xE01,
    ranges = { 0xE01, 0xE3A, 0xE40, 0xE5B },
    fonts = { "Norasi.otf", "Norasi-Bold.otf", "Norasi-Italic.otf", "Norasi-BoldItalic.otf" },
    linebreak = "th",
  },
  { name = "armenian", tag = "Armenian", probe = 0x531, ranges = { 0x530, 0x58F }, fonts = free_serif(true, true, true) },
  { name = "georgian", tag = "Georgian", probe = 0x10D0, ranges = { 0x10A0, 0x10FF }, fonts = free_serif(true, true, true) },
  { name = "ethiopic", tag = "Ethiopic", probe = 0x1200, ranges = { 0x1200, 0x137F }, fonts = free_serif(false, false, false) },
}

local BABEL_THAI_FONT_HOOK =
  "\\makeatletter\\ifdefined\\bbl@xenohyph@d\\global\\let\\bbl@xenohyph\\bbl@xenohyph@d\\fi\\makeatother"

local MAIN_FONT_MARKERS = { "\\setmainfont", "polyglossia", "\\babelfont", "mathspec" }

local CJK_FONT_MARKERS = { "\\setCJKmainfont", "xeCJK", "ctex", "kotex", "luatexja", "CJKutf8" }

local CJK_CLASSES = {
  ctexart = true, ctexrep = true, ctexbook = true, ctexbeamer = true, oblivoir = true,
  bxjsarticle = true, bxjsreport = true, bxjsbook = true, ltjsarticle = true, ltjarticle = true,
}

local SKIPPED_METADATA = {
  bibliography = true, csl = true, references = true, nocite = true, ["header-includes"] = true,
  ["include-before"] = true, ["include-after"] = true, mainfont = true, sansfont = true, monofont = true,
  mathfont = true, CJKmainfont = true, CJKoptions = true, mainfontoptions = true,
}

local function within(ranges, code)
  for index = 1, #ranges, 2 do
    if code >= ranges[index] and code <= ranges[index + 1] then
      return true
    end
  end
  return false
end

local classes = {}

local function classify(code)
  local known = classes[code]
  if known ~= nil then
    return known
  end
  local class
  for _, script in ipairs(SCRIPTS) do
    if within(script.ranges, code) then
      class = script
      break
    end
  end
  if not class then
    if within(HANGUL, code) then
      class = "hangul"
    elseif within(KANA, code) then
      class = "kana"
    elseif within(HAN, code) then
      class = "han"
    elseif within(EMOJI, code) then
      class = "emoji"
    elseif within(VARIATION_SELECTORS, code) then
      class = "selector"
    elseif within(INVISIBLE, code) then
      class = "plain"
    elseif within(LATIN_MODERN, code) then
      class = "plain"
    elseif within(WIDER_LATIN, code) then
      class = "wider"
    elseif within(SYMBOLS, code) then
      class = "symbol"
    else
      class = "other"
    end
  end
  classes[code] = class
  return class
end

local function is_letter(code)
  return (code >= 0x41 and code <= 0x5A) or (code >= 0x61 and code <= 0x7A) or (code >= 0xC0 and code < 0x2000)
end

local function scan_text(text, seen)
  if not utf8.len(text) then
    return
  end
  for _, code in utf8.codes(text) do
    if code >= 0x80 or is_letter(code) then
      seen.total[code] = (seen.total[code] or 0) + 1
    end
  end
end

local function scan_document(doc)
  local seen = { total = {}, skip = false }
  local function take(text)
    scan_text(text, seen)
  end
  doc:walk({
    Str = function(element)
      take(element.text)
    end,
    Code = function(element)
      take(element.text)
    end,
    CodeBlock = function(element)
      take(element.text)
    end,
    RawInline = function(element)
      if element.format:match("tex") then
        take(element.text)
      end
    end,
    RawBlock = function(element)
      if element.format:match("tex") then
        take(element.text)
      end
    end,
  })
  for key, value in pairs(doc.meta) do
    if not SKIPPED_METADATA[key] then
      take(pandoc.utils.stringify(value))
    end
  end
  return seen.total
end

local function tally(codes)
  local counts = { latin = 0, hangul = 0, kana = 0, han = 0, wider = 0, symbols = {}, emoji = {}, selectors = {}, scripts = {} }
  for code, count in pairs(codes) do
    local class = classify(code)
    if type(class) == "table" then
      counts.scripts[class.name] = (counts.scripts[class.name] or 0) + count
    elseif class == "hangul" or class == "kana" or class == "han" then
      counts[class] = counts[class] + count
    elseif class == "wider" then
      counts.wider = counts.wider + count
      counts.latin = counts.latin + count
    elseif class == "symbol" then
      counts.symbols[#counts.symbols + 1] = code
    elseif class == "emoji" then
      counts.emoji[#counts.emoji + 1] = code
    elseif class == "selector" then
      counts.selectors[#counts.selectors + 1] = code
    elseif class == "plain" and is_letter(code) then
      counts.latin = counts.latin + count
    end
  end
  table.sort(counts.symbols)
  table.sort(counts.emoji)
  table.sort(counts.selectors)
  return counts
end

local function header_text(meta)
  local value = meta["header-includes"]
  if value == nil then
    return ""
  end
  local parts = {}
  local function collect(element)
    parts[#parts + 1] = element.text
  end
  pandoc.Pandoc({}, { probe = value }):walk({ RawBlock = collect, RawInline = collect })
  parts[#parts + 1] = pandoc.utils.stringify(value)
  return table.concat(parts, "\n")
end

local function mentions(text, markers)
  for _, marker in ipairs(markers) do
    if text:find(marker, 1, true) then
      return true
    end
  end
  return false
end

local function document_class(meta)
  return meta.documentclass and pandoc.utils.stringify(meta.documentclass) or ""
end

local function add_header(meta, text)
  local block = pandoc.MetaBlocks({ pandoc.RawBlock("latex", text) })
  local current = meta["header-includes"]
  if current == nil then
    meta["header-includes"] = pandoc.MetaList({ block })
  elseif current.t == "MetaList" or pandoc.utils.type(current) == "List" then
    current[#current + 1] = block
    meta["header-includes"] = current
  else
    meta["header-includes"] = pandoc.MetaList({ current, block })
  end
end

local function language_of(meta)
  local value = meta.lang and pandoc.utils.stringify(meta.lang) or ""
  return value:lower()
end

local function primary_language(language)
  return language:match("^[^-_]+") or ""
end

local function count_of(codes, text)
  local total = 0
  for _, code in utf8.codes(text) do
    total = total + (codes[code] or 0)
  end
  return total
end

local function cjk_kind(counts, codes, language)
  local chosen = CJK_LANGUAGES[language] or CJK_LANGUAGES[primary_language(language)]
  if chosen then
    return chosen
  end
  if counts.hangul > 0 and counts.hangul * 2 >= counts.han + counts.kana then
    return "korean"
  end
  if counts.kana > 0 and counts.kana * 5 >= counts.han then
    return "japanese"
  end
  if count_of(codes, TRADITIONAL_ONLY) > count_of(codes, SIMPLIFIED_ONLY) then
    return "traditional"
  end
  return "simplified"
end

local function apply_cjk(doc, counts, codes, language, header)
  if counts.hangul + counts.kana + counts.han == 0 then
    return
  end
  if not doc.meta.CJKmainfont then
    local kind = CJK_FONTS[cjk_kind(counts, codes, language)]
    doc.meta.CJKmainfont = kind.main
    if not doc.meta.CJKoptions then
      local options = pandoc.MetaList({})
      for index, option in ipairs(kind.options) do
        options[index] = option
      end
      doc.meta.CJKoptions = options
    end
    local fallback = {}
    for index, font in ipairs(kind.fallback) do
      fallback[index] = "{" .. font .. "}"
    end
    header[#header + 1] = "\\ifdefined\\xeCJKsetup\\xeCJKsetup{AutoFallBack=true}"
      .. "\\setCJKfallbackfamilyfont{\\CJKrmdefault}{" .. table.concat(fallback, ",") .. "}\\fi"
  end
  if counts.hangul > 0 then
    header[#header + 1] = "\\ifdefined\\xeCJKsetup\\xeCJKsetup{CJKspace=true}\\fi"
  end
end

local function dominant_script(counts, language)
  local primary = primary_language(language)
  for _, script in ipairs(SCRIPTS) do
    local count = counts.scripts[script.name] or 0
    if script.rtl and count > 0 then
      if script.languages[primary] then
        return script
      end
      if language == "" and count > counts.latin + counts.han + counts.hangul + counts.kana then
        return script
      end
    end
  end
  return nil
end

local function font_options(script)
  local fonts = script.fonts
  local regular = fonts[1]
  local options = { "Script=" .. script.tag }
  local function style(key, font, features)
    if font then
      options[#options + 1] = key .. "Font=" .. font
    else
      options[#options + 1] = key .. "Font=" .. regular
      options[#options + 1] = key .. "Features={" .. features .. "}"
    end
  end
  style("Bold", fonts[2], "FakeBold=2")
  style("Italic", fonts[3], "FakeSlant=0.15")
  style("BoldItalic", fonts[4], "FakeBold=2,FakeSlant=0.15")
  return table.concat(options, ",")
end

local function run_macro(script)
  return "oleaflyrun" .. script.name
end

local function declare_script(script, header)
  local macro = run_macro(script)
  local font = "\\oleaflyfont" .. script.name
  header[#header + 1] = "\\IfFontExistsTF{" .. script.fonts[1] .. "}{\\newfontfamily" .. font .. "[" .. font_options(script) .. "]{" .. script.fonts[1] .. "}}{\\let" .. font .. "\\relax}"
  local open, close = "", ""
  if script.rtl then
    open, close = "\\beginR ", "\\endR"
  end
  local linebreak = ""
  if script.linebreak then
    linebreak = '\\XeTeXlinebreaklocale "' .. script.linebreak .. '"\\XeTeXlinebreakskip=0pt plus 1pt\\relax '
  end
  local probe = string.format('"%X', script.probe)
  local shaping = "\\addfontfeatures{Script=" .. script.tag .. "}"
  header[#header + 1] = "\\DeclareRobustCommand{\\" .. macro .. "}[1]{{\\leavevmode\\iffontchar\\font" .. probe .. " " .. shaping .. "\\else" .. font .. "\\fi" .. linebreak .. " " .. open .. "#1" .. close .. "}}"
  header[#header + 1] = "\\AtBeginDocument{\\ifdefined\\pdfstringdefDisableCommands\\pdfstringdefDisableCommands{\\let\\" .. macro .. "\\oleaflyplaintext}\\fi}"
end

local function glyph_definition(code, macro)
  return string.format("\\newunicodechar{%s}{\\%s{\"%X}}", utf8.char(code), macro, code)
end

local function unclaimed(codes, preamble)
  local kept = {}
  for _, code in ipairs(codes) do
    if not preamble:find("\\newunicodechar{" .. utf8.char(code) .. "}", 1, true) then
      kept[#kept + 1] = code
    end
  end
  return kept
end

local function declare_glyphs(counts, header, uncovered, preamble)
  for _, code in ipairs(uncovered) do
    counts.symbols[#counts.symbols + 1] = code
  end
  counts.symbols = unclaimed(counts.symbols, preamble)
  counts.emoji = unclaimed(counts.emoji, preamble)
  counts.selectors = unclaimed(counts.selectors, preamble)
  local symbols = counts.symbols
  local emoji = counts.emoji
  if #symbols == 0 and #emoji == 0 then
    return
  end
  header[#header + 1] = "\\usepackage{newunicodechar}"
  header[#header + 1] = "\\newcommand{\\oleaflytryfont}[3]{{#1\\iffontchar\\font#2\\relax\\Uchar#2\\relax\\else#3\\fi}}"
  header[#header + 1] = "\\newcommand{\\oleaflyplainglyph}[1]{\\Uchar#1\\relax}"
  local sources = { symbol = {}, emoji = {} }
  if #symbols > 0 then
    header[#header + 1] = "\\IfFontExistsTF{FreeSerif.otf}{\\newfontfamily\\oleaflyserifsymbols[BoldFont=FreeSerif.otf,ItalicFont=FreeSerif.otf,BoldItalicFont=FreeSerif.otf]{FreeSerif.otf}}{\\let\\oleaflyserifsymbols\\relax}"
    sources.symbol = { "\\oleaflyserifsymbols", "\\oleaflysanssymbols" }
  end
  if #emoji > 0 then
    header[#header + 1] = "\\IfFontExistsTF{NotoEmoji-Regular.ttf}{\\newfontfamily\\oleaflyemoji[Scale=1,BoldFont=NotoEmoji-Regular.ttf,ItalicFont=NotoEmoji-Regular.ttf,BoldItalicFont=NotoEmoji-Regular.ttf]{NotoEmoji-Regular.ttf}}{\\let\\oleaflyemoji\\relax}"
    sources.emoji = { "\\oleaflyemoji", "\\oleaflysanssymbols" }
  end
  header[#header + 1] = "\\IfFontExistsTF{DejaVuSans.ttf}{\\newfontfamily\\oleaflysanssymbols[BoldFont=DejaVuSans.ttf,ItalicFont=DejaVuSans.ttf,BoldItalicFont=DejaVuSans.ttf]{DejaVuSans.ttf}}{\\let\\oleaflysanssymbols\\relax}"
  local function declare_macro(name, fonts)
    if #fonts == 0 then
      return
    end
    local body = "\\Uchar#1\\relax"
    for index = #fonts, 1, -1 do
      body = "\\oleaflytryfont{" .. fonts[index] .. "}{#1}{" .. body .. "}"
    end
    header[#header + 1] = "\\DeclareRobustCommand{\\" .. name .. "}[1]{\\ifmmode\\Uchar#1\\relax\\else\\iffontchar\\font#1\\relax\\Uchar#1\\relax\\else" .. body .. "\\fi\\fi}"
    header[#header + 1] = "\\AtBeginDocument{\\ifdefined\\pdfstringdefDisableCommands\\pdfstringdefDisableCommands{\\let\\" .. name .. "\\oleaflyplainglyph}\\fi}"
  end
  declare_macro("oleaflysymbolglyph", sources.symbol)
  declare_macro("oleaflyemojiglyph", sources.emoji)
  for _, code in ipairs(symbols) do
    header[#header + 1] = glyph_definition(code, "oleaflysymbolglyph")
  end
  for _, code in ipairs(emoji) do
    header[#header + 1] = glyph_definition(code, "oleaflyemojiglyph")
  end
end

local function run_class(code, skipped)
  local class = classify(code)
  if type(class) == "table" then
    if skipped == class then
      return false
    end
    return class
  end
  if code >= 0x80 and class ~= "plain" and class ~= "symbol" and class ~= "selector" then
    return false
  end
  if is_letter(code) then
    return false
  end
  return nil
end

local function split_text(text, skipped)
  local pieces = {}
  local current, current_class = {}, nil
  local started = false
  for _, code in utf8.codes(text) do
    local class = run_class(code, skipped)
    if not started or class ~= current_class then
      if started then
        pieces[#pieces + 1] = { text = table.concat(current), class = current_class }
      end
      current, current_class, started = {}, class, true
    end
    current[#current + 1] = utf8.char(code)
  end
  if started then
    pieces[#pieces + 1] = { text = table.concat(current), class = current_class }
  end
  return pieces
end

local function wrap_runs(inlines, skipped)
  local output = pandoc.List()
  local run, run_script = nil, nil
  local pending = pandoc.List()
  local changed = false
  local function close_run()
    if run then
      output:insert(pandoc.RawInline("latex", "\\" .. run_macro(run_script) .. "{"))
      output:extend(run)
      output:insert(pandoc.RawInline("latex", "}"))
      run, run_script = nil, nil
      changed = true
    end
    output:extend(pending)
    pending = pandoc.List()
  end
  local function push(inline, class)
    if class then
      if run and class == run_script then
        run:extend(pending)
        pending = pandoc.List()
        run:insert(inline)
      else
        close_run()
        run, run_script = pandoc.List({ inline }), class
      end
    elseif class == false then
      close_run()
      output:insert(inline)
    elseif run then
      pending:insert(inline)
    else
      output:insert(inline)
    end
  end
  for _, inline in ipairs(inlines) do
    if inline.t == "Str" and utf8.len(inline.text) then
      for _, piece in ipairs(split_text(inline.text, skipped)) do
        push(pandoc.Str(piece.text), piece.class)
      end
    elseif inline.t == "Space" or inline.t == "SoftBreak" then
      push(inline, nil)
    else
      close_run()
      output:insert(inline)
    end
  end
  close_run()
  if changed then
    return output
  end
  return nil
end

function Pandoc(doc)
  if not FORMAT:match("latex") then
    return nil
  end
  local codes = scan_document(doc)
  local counts = tally(codes)
  local language = language_of(doc.meta)
  local header = {}
  local preamble = header_text(doc.meta)
  local fixed_family = doc.meta.fontfamily ~= nil or mentions(preamble, MAIN_FONT_MARKERS)
  local dominant = dominant_script(counts, language)
  local uncovered = {}

  if not mentions(preamble, CJK_FONT_MARKERS) and not CJK_CLASSES[document_class(doc.meta)] then
    apply_cjk(doc, counts, codes, language, header)
  end

  if dominant then
    if not doc.meta.lang then
      doc.meta.lang = dominant.lang
    end
    if not doc.meta.dir then
      doc.meta.dir = "rtl"
    end
    if not doc.meta.mainfont and not fixed_family then
      local fonts = dominant.fonts
      doc.meta.mainfont = fonts[1]
      doc.meta.mainfontoptions = "BoldFont=" .. fonts[2] .. ",ItalicFont=" .. fonts[3] .. ",BoldItalicFont=" .. fonts[4]
      for code in pairs(codes) do
        if classify(code) == "wider" then
          uncovered[#uncovered + 1] = code
        end
      end
      table.sort(uncovered)
    end
  elseif counts.wider > 0 and not fixed_family then
    if not doc.meta.mainfont then
      header[#header + 1] = "\\IfFontExistsTF{cmunrm.otf}{\\setmainfont[BoldFont=cmunbx.otf,ItalicFont=cmunti.otf,BoldItalicFont=cmunbi.otf]{cmunrm.otf}}{}"
      for code in pairs(COMPUTER_MODERN_GAPS) do
        if codes[code] then
          uncovered[#uncovered + 1] = code
        end
      end
      table.sort(uncovered)
    end
    if not doc.meta.sansfont then
      header[#header + 1] = "\\IfFontExistsTF{cmunss.otf}{\\setsansfont[BoldFont=cmunsx.otf,ItalicFont=cmunsi.otf,BoldItalicFont=cmunso.otf]{cmunss.otf}}{}"
    end
    if not doc.meta.monofont then
      header[#header + 1] = "\\IfFontExistsTF{cmuntt.otf}{\\setmonofont[BoldFont=cmuntb.otf,ItalicFont=cmunit.otf,BoldItalicFont=cmuntx.otf]{cmuntt.otf}}{}"
    end
  end

  local run_scripts = {}
  for _, script in ipairs(SCRIPTS) do
    if counts.scripts[script.name] and script ~= dominant then
      run_scripts[#run_scripts + 1] = script
    end
  end
  if #run_scripts > 0 then
    header[#header + 1] = "\\TeXXeTstate=1"
    header[#header + 1] = "\\newcommand{\\oleaflyplaintext}[1]{#1}"
    if primary_language(language) == "th" then
      header[#header + 1] = BABEL_THAI_FONT_HOOK
    end
    for _, script in ipairs(run_scripts) do
      declare_script(script, header)
    end
  end

  declare_glyphs(counts, header, uncovered, preamble)

  if #counts.selectors > 0 then
    if #counts.symbols == 0 and #counts.emoji == 0 then
      header[#header + 1] = "\\usepackage{newunicodechar}"
    end
    for _, code in ipairs(counts.selectors) do
      header[#header + 1] = string.format("\\newunicodechar{%s}{}", utf8.char(code))
    end
  end

  if doc.meta.keywords then
    add_header(doc.meta, "\\providecommand{\\xmpquote}[1]{#1}")
  end

  if #header > 0 then
    local plain = {}
    for _, script in ipairs(run_scripts) do
      plain[#plain + 1] = "\\newcommand{\\" .. run_macro(script) .. "}[1]{#1}"
    end
    add_header(
      doc.meta,
      "\\ifdefined\\XeTeXversion\n" .. table.concat(header, "\n") .. "\n\\else\n" .. table.concat(plain, "\n") .. "\n\\fi"
    )
  end

  if #run_scripts > 0 then
    return doc:walk({
      Inlines = function(inlines)
        return wrap_runs(inlines, dominant)
      end,
    })
  end
  return doc
end
