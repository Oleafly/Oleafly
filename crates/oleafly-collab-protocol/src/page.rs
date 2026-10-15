macro_rules! status_badge {
    ($tone:literal, $paths:literal) => {
        concat!(
            "<div class=\"status ",
            $tone,
            "\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.25\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">",
            $paths,
            "</svg></div>"
        )
    };
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Success,
    Problem,
    Notice,
    Waiting,
    Info,
}

pub const STYLE: &str = concat!(
    "*{box-sizing:border-box}",
    "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2.5rem 1rem;",
    "font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:1rem;line-height:1.5;",
    "color:#18181b;background-color:#ffffff;",
    "background-image:radial-gradient(rgba(156,163,175,0.5) 1px,transparent 1px);background-size:22px 22px}",
    ".shell{width:100%;max-width:26rem;display:flex;flex-direction:column;align-items:center;gap:1.25rem}",
    ".brand{display:flex;flex-direction:column;align-items:center;gap:0.5rem;font-weight:600;font-size:0.9375rem;letter-spacing:-0.01em}",
    ".brand svg{width:3.5rem;height:3.5rem;display:block}",
    ".card{width:100%;background:#ffffff;border:1px solid #e4e4e7;border-radius:1rem;padding:2rem 1.75rem;text-align:center}",
    ".status{width:3rem;height:3rem;margin:0 auto 1rem;border-radius:999px;display:flex;align-items:center;justify-content:center}",
    ".status svg{width:1.5rem;height:1.5rem}",
    ".status.success{background:#dcfce7;color:#16a34a}",
    ".status.problem{background:#fee2e2;color:#dc2626}",
    ".status.notice{background:#fef3c7;color:#b45309}",
    ".status.waiting{background:#dbeafe;color:#2563eb}",
    ".status.info{background:#dbeafe;color:#2563eb}",
    "h1{margin:0;font-size:1.25rem;line-height:1.35;font-weight:650;letter-spacing:-0.01em}",
    "p{margin:0.5rem 0 0;color:#52525b;font-size:0.9375rem}",
    ".detail{margin:1rem 0 0;padding:0.75rem 1rem;border-radius:0.75rem;background:#f4f4f5;color:#18181b;font-size:0.875rem;overflow-wrap:anywhere}",
    ".next{margin-top:1rem;padding-top:1rem;border-top:1px solid #e4e4e7;font-size:0.875rem;color:#52525b}",
    ".error{color:#b91c1c}",
    ".code{margin-top:1rem;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:1.5rem;letter-spacing:0.15em;color:#18181b}",
    "form{margin:1.25rem 0 0;text-align:left}",
    "form+form{margin-top:0.5rem}",
    "label{display:block;margin:0 0 0.375rem;font-weight:600;font-size:0.875rem}",
    "input{width:100%;padding:0.65rem 0.8rem;border:1px solid #d4d4d8;border-radius:0.625rem;font:inherit;color:inherit;background:#ffffff}",
    "input:focus{outline:none;border-color:#2563eb;background:#f8fbff}",
    "input+button{margin-top:0.75rem}",
    "button,a.button{display:flex;width:100%;align-items:center;justify-content:center;gap:0.5rem;padding:0.65rem 1rem;",
    "border:1px solid #d4d4d8;border-radius:0.625rem;background:#ffffff;color:#18181b;font:inherit;font-size:0.9375rem;font-weight:600;",
    "text-decoration:none;cursor:pointer}",
    "a.button+a.button{margin-top:0.5rem}",
    ".actions{margin-top:1.25rem}",
    "button:hover,a.button:hover{background:#f4f4f5}",
    "button:focus-visible,a.button:focus-visible{outline:none;background:#e4e4e7}",
    "button.primary,a.button.primary{background:#2563eb;border-color:#2563eb;color:#ffffff}",
    "button.primary:hover,a.button.primary:hover{background:#1d4ed8;border-color:#1d4ed8}",
    "button.primary:focus-visible,a.button.primary:focus-visible{background:#1e40af;border-color:#1e40af}",
    ".foot{font-size:0.8125rem;color:#71717a;text-align:center}",
    "@media (prefers-color-scheme:dark){",
    "body{color:#f4f4f5;background-color:#121317;background-image:radial-gradient(rgba(255,255,255,0.17) 1px,transparent 1px)}",
    ".card{background:#18191d;border-color:rgba(255,255,255,0.1)}",
    "p,.next{color:#a1a1aa}",
    ".next{border-top-color:rgba(255,255,255,0.1)}",
    ".detail{background:#23242a;color:#f4f4f5}",
    ".code{color:#f4f4f5}",
    ".error{color:#f87171}",
    ".status.success{background:rgba(22,163,74,0.18);color:#4ade80}",
    ".status.problem{background:rgba(220,38,38,0.18);color:#f87171}",
    ".status.notice{background:rgba(217,119,6,0.18);color:#fbbf24}",
    ".status.waiting{background:rgba(37,99,235,0.2);color:#60a5fa}",
    ".status.info{background:rgba(37,99,235,0.2);color:#60a5fa}",
    "input{background:#121317;border-color:rgba(255,255,255,0.16)}",
    "input:focus{background:#162036;border-color:#3b82f6}",
    "button,a.button{background:#18191d;color:#f4f4f5;border-color:rgba(255,255,255,0.16)}",
    "button:hover,a.button:hover{background:#23242a}",
    "button:focus-visible,a.button:focus-visible{background:#2c2d33}",
    ".foot{color:#a1a1aa}",
    "}"
);

const LOGO: &str = concat!(
    "<svg viewBox=\"0 0 192 192\" role=\"img\" aria-label=\"Oleafly\" xmlns=\"http://www.w3.org/2000/svg\">",
    "<defs><linearGradient id=\"oleafly-tile\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">",
    "<stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#eef7e6\"/></linearGradient></defs>",
    "<rect x=\"1\" y=\"1\" width=\"190\" height=\"190\" rx=\"34\" fill=\"url(#oleafly-tile)\" stroke=\"#e2eadb\" stroke-width=\"2\"/>",
    "<path transform=\"translate(36.8 37.3) scale(4.85)\" fill=\"#7ccb43\" ",
    "d=\"M21 2C6 2 4 16 3 22h1.998c.666-3.333 2.333-5.166 5.002-5.5 4-.5 7-4 8-7l-1.5-1 1-1c1-1 2.004-2.5 3.5-5.5z\"/>",
    "</svg>"
);

pub fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            other => escaped.push(other),
        }
    }
    escaped
}

pub fn status(tone: Tone) -> &'static str {
    match tone {
        Tone::Success => status_badge!("success", "<path d=\"M5 12.5l4.5 4.5L19 7.5\"/>"),
        Tone::Problem => status_badge!("problem", "<path d=\"M7 7l10 10M17 7L7 17\"/>"),
        Tone::Notice => status_badge!("notice", "<path d=\"M12 7v6\"/><path d=\"M12 17h.01\"/>"),
        Tone::Waiting => status_badge!(
            "waiting",
            "<circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"M12 8v4l2.5 2.5\"/>"
        ),
        Tone::Info => status_badge!(
            "info",
            "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v5\"/><path d=\"M12 7.5h.01\"/>"
        ),
    }
}

pub fn document(title: &str, card: &str, footer: Option<&str>) -> String {
    document_in("en", title, card, footer)
}

pub fn document_in(lang: &str, title: &str, card: &str, footer: Option<&str>) -> String {
    let footer = footer
        .map(|text| format!("<footer class=\"foot\">{}</footer>", escape(text)))
        .unwrap_or_default();
    format!(
        "<!doctype html><html lang=\"{}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"referrer\" content=\"same-origin\"><meta name=\"color-scheme\" content=\"light dark\"><title>{}</title><style>{STYLE}</style></head><body><main class=\"shell\"><div class=\"brand\">{LOGO}<span>Oleafly</span></div><section class=\"card\">{card}</section>{footer}</main></body></html>",
        escape(lang),
        escape(title)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_page_wears_the_brand_and_centres_one_card() {
        let html = document("Signed <in>", "<h1>Done</h1>", Some("Oleafly Lab"));
        assert!(html.starts_with("<!doctype html>"));
        assert!(html.contains("<title>Signed &lt;in&gt;</title>"));
        assert!(html.contains("<meta name=\"referrer\" content=\"same-origin\">"));
        assert!(html.contains("<div class=\"brand\"><svg"));
        assert!(html.contains("aria-label=\"Oleafly\""));
        assert!(html.contains("<section class=\"card\"><h1>Done</h1></section>"));
        assert!(html.contains("<footer class=\"foot\">Oleafly Lab</footer>"));
        assert!(!document("Title", "<p>Body</p>", None).contains("<footer"));
    }

    #[test]
    fn the_page_names_its_language() {
        assert!(document("Title", "<p>Body</p>", None)
            .starts_with("<!doctype html><html lang=\"en\"><head>"));
        assert!(document_in("pt-BR", "Título", "<p>Olá</p>", None)
            .starts_with("<!doctype html><html lang=\"pt-BR\"><head>"));
        assert!(
            document_in("zh-Hans", "标题", "<p>你好</p>", None).contains("<html lang=\"zh-Hans\">")
        );
        assert!(document_in("x\"><script>", "T", "", None)
            .contains("<html lang=\"x&quot;&gt;&lt;script&gt;\">"));
    }

    #[test]
    fn the_page_style_matches_the_app() {
        for piece in [
            "radial-gradient(",
            "background-size:22px 22px",
            "#2563eb",
            "align-items:center",
            "justify-content:center",
            "min-height:100vh",
            "@media (prefers-color-scheme:dark)",
        ] {
            assert!(STYLE.contains(piece), "missing {piece}");
        }
    }

    #[test]
    fn pages_draw_no_outlines_rings_or_pixel_text() {
        assert!(!STYLE.replace("outline:none", "").contains("outline"));
        assert!(!STYLE.contains("box-shadow"));
        let pixel_text = STYLE.split("font-size:").skip(1).any(|rest| {
            rest.split([';', '}'])
                .next()
                .is_some_and(|value| value.ends_with("px"))
        });
        assert!(!pixel_text);
    }

    #[test]
    fn each_tone_has_its_own_icon() {
        let icons = [
            Tone::Success,
            Tone::Problem,
            Tone::Notice,
            Tone::Waiting,
            Tone::Info,
        ]
        .map(status);
        for (index, icon) in icons.iter().enumerate() {
            assert!(icon.contains("<svg"), "{icon}");
            assert!(icon.contains("aria-hidden=\"true\""));
            assert!(icons.iter().skip(index + 1).all(|other| other != icon));
        }
        assert!(status(Tone::Success).starts_with("<div class=\"status success\">"));
        assert!(status(Tone::Problem).starts_with("<div class=\"status problem\">"));
    }

    #[test]
    fn text_is_escaped_for_html() {
        assert_eq!(
            escape("<a href=\"x\">Tom & 'Jo'</a>"),
            "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jo&#39;&lt;/a&gt;"
        );
    }
}
