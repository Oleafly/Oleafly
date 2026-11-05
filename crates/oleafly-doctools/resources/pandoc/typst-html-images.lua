function Image(image)
  if not image.src:match("^data:") then
    return {}
  end
  local style = image.attributes.style or ""
  image.attributes.style = nil
  image.attributes.height = nil
  image.attributes.width = style:match("width:%s*([%d.]+[%a%%]*)")
  return image
end
