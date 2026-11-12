use std::path::Path;

pub(crate) fn media_type(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "avif" => "image/avif",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "jpeg" | "jpg" => "image/jpeg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "json" | "map" => "application/json",
        "wasm" => "application/wasm",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "css" => "text/css",
        "html" | "htm" => "text/html",
        "js" | "mjs" => "text/javascript",
        "md" => "text/markdown",
        "tex" => "application/x-tex",
        "txt" => "text/plain",
        "otf" => "font/otf",
        "ttf" => "font/ttf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_page_parts_get_the_types_browsers_require() {
        for (name, expected) in [
            ("index.HTML", "text/html"),
            ("reveal.js", "text/javascript"),
            ("module.mjs", "text/javascript"),
            ("theme.css", "text/css"),
            ("KaTeX_Main.woff2", "font/woff2"),
            ("figure.svg", "image/svg+xml"),
            ("search.json", "application/json"),
        ] {
            assert_eq!(media_type(Path::new(name)), Some(expected), "{name}");
        }
        assert_eq!(media_type(Path::new("README")), None);
        assert_eq!(media_type(Path::new("archive.qmd")), None);
    }
}
