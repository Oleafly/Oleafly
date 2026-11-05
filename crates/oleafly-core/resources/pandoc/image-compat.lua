local CONVERTED = { svg = true, gif = true, webp = true }
local REFUSED = { tif = true, tiff = true, avif = true, heic = true, heif = true, jxl = true }
local UNSUPPORTED_MARKER = "[oleafly:unsupported-image]"
local FAILED_MARKER = "[oleafly:image-conversion-failed]"
local WRAPPER = '#set page(width: auto, height: auto, margin: 0pt)\n#image("%s")\n'

local converted = {}

local function typst_program()
  return pandoc.system.environment().OLEAFLY_PANDOC_TYPST
end

local function stop(marker, source)
  error(marker .. " " .. source, 0)
end

local function is_remote(source)
  return source:match("^%a[%w+.-]+:") ~= nil
end

local function extension_of(source)
  local name = source:match("^[^?#]*") or source
  local extension = name:match("%.([%w]+)$")
  return extension and extension:lower() or nil
end

local function read_source(source)
  local ok, _, contents = pcall(pandoc.mediabag.fetch, source)
  if ok and contents then
    return contents
  end
  return nil
end

local function write_file(name, contents)
  local handle = assert(io.open(name, "wb"))
  handle:write(contents)
  handle:close()
end

local function read_file(name)
  local handle = assert(io.open(name, "rb"))
  local contents = handle:read("a")
  handle:close()
  return contents
end

local function convert(contents, extension, typst)
  return pandoc.system.with_temporary_directory("oleafly-image", function(directory)
    return pandoc.system.with_working_directory(directory, function()
      local input = "in." .. extension
      write_file(input, contents)
      write_file("wrap.typ", string.format(WRAPPER, input))
      pandoc.pipe(typst, { "compile", "--root", ".", "wrap.typ", "out.pdf" }, "")
      return read_file("out.pdf")
    end)
  end)
end

local function converted_name(source, extension)
  if converted[source] then
    return converted[source]
  end
  local contents = read_source(source)
  if not contents then
    return nil
  end
  local typst = typst_program()
  if not typst or typst == "" then
    stop(FAILED_MARKER, source)
  end
  local ok, pdf = pcall(convert, contents, extension, typst)
  if not ok or not pdf or pdf == "" then
    stop(FAILED_MARKER, source)
  end
  local name = pandoc.utils.sha1(contents) .. ".pdf"
  pandoc.mediabag.insert(name, "application/pdf", pdf)
  converted[source] = name
  return name
end

function Image(image)
  if not FORMAT:match("latex") or is_remote(image.src) then
    return nil
  end
  local extension = extension_of(image.src)
  if not extension then
    return nil
  end
  if REFUSED[extension] then
    stop(UNSUPPORTED_MARKER, image.src)
  end
  if not CONVERTED[extension] then
    return nil
  end
  local name = converted_name(image.src, extension)
  if not name then
    return nil
  end
  image.src = name
  return image
end
