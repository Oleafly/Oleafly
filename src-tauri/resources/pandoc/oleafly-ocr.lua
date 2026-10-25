-- OCR models (glm-ocr, deepseek-ocr, dots.ocr) and Mathpix put HTML tables
-- and LaTeX blocks inside Markdown. Turn them into pandoc elements so every
-- writer keeps them. The filter runs as three passes: read the metadata,
-- convert raw blocks, then shape the result for a fragment.
local fragment = false

local function read_blocks(text, format)
  local ok, doc = pcall(pandoc.read, text, format)
  if ok then return doc.blocks end
  return nil
end

-- Math inside table cells uses $...$ or \(...\). Fall back to the plain HTML
-- reader if this pandoc refuses the math extensions for HTML.
local function read_html(text)
  return read_blocks(text, "html+tex_math_dollars+tex_math_single_backslash")
    or read_blocks(text, "html")
end

local ALIGN = { AlignLeft = "l", AlignRight = "r", AlignCenter = "c" }

local function add_rows(rows, lines)
  for _, row in ipairs(rows) do
    local cells = {}
    for _, cell in ipairs(row.cells) do
      local text = pandoc.write(pandoc.Pandoc(cell.contents), "latex")
      cells[#cells + 1] = (text:gsub("%s*\n%s*", " "))
    end
    lines[#lines + 1] = table.concat(cells, " & ") .. " \\\\"
  end
end

-- A fragment goes into someone else's document: plain tabular with \hline,
-- no longtable or booktabs.
local function tabular(tbl)
  local width = #tbl.colspecs
  local function widen(rows)
    for _, row in ipairs(rows) do width = math.max(width, #row.cells) end
  end
  widen(tbl.head.rows)
  for _, body in ipairs(tbl.bodies) do
    widen(body.head)
    widen(body.body)
  end
  widen(tbl.foot.rows)
  local spec = {}
  for i = 1, width do
    local colspec = tbl.colspecs[i]
    spec[i] = (colspec and ALIGN[tostring(colspec[1])]) or "l"
  end
  local lines = { "\\begin{tabular}{" .. table.concat(spec) .. "}", "\\hline" }
  add_rows(tbl.head.rows, lines)
  if #tbl.head.rows > 0 then lines[#lines + 1] = "\\hline" end
  for _, body in ipairs(tbl.bodies) do
    add_rows(body.head, lines)
    add_rows(body.body, lines)
  end
  add_rows(tbl.foot.rows, lines)
  lines[#lines + 1] = "\\hline"
  lines[#lines + 1] = "\\end{tabular}"
  return pandoc.RawBlock("latex", table.concat(lines, "\n"))
end

-- Tight lists make the LaTeX writer emit \tightlist, which only pandoc's
-- template defines.
local function loosen(list)
  for _, item in ipairs(list.content) do
    for i, block in ipairs(item) do
      if block.t == "Plain" then item[i] = pandoc.Para(block.content) end
    end
  end
  return list
end

local function latex_fragment() return fragment and FORMAT == "latex" end

local function is_tex(format) return format == "latex" or format == "tex" end

return {
  { Meta = function(meta) fragment = meta["oleafly-fragment"] == true end },
  {
    RawBlock = function(el)
      if el.format == "html" then
        return read_html(el.text)
      end
      if is_tex(el.format) and FORMAT ~= "latex" then
        return read_blocks(el.text, "latex")
      end
    end,
    RawInline = function(el)
      if is_tex(el.format) and FORMAT ~= "latex" then
        local blocks = read_blocks(el.text, "latex")
        if blocks then return pandoc.utils.blocks_to_inlines(blocks) end
      end
    end,
  },
  {
    Table = function(tbl) if latex_fragment() then return tabular(tbl) end end,
    BulletList = function(list) if latex_fragment() then return loosen(list) end end,
    OrderedList = function(list) if latex_fragment() then return loosen(list) end end,
    -- The typst writer's #horizontalrule comes from pandoc's template.
    HorizontalRule = function()
      if fragment and FORMAT == "typst" then
        return pandoc.RawBlock("typst", "#line(length: 100%)")
      end
    end,
  },
}
