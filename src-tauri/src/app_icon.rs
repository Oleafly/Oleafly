use std::sync::{PoisonError, RwLock};

use tauri::{AppHandle, Runtime};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum AppIconVariant {
    #[default]
    Pastel,
    Blue,
    Light,
    Prism,
    Iridescent,
    Ocean,
    Mint,
    Aurora,
    Sunset,
    Coral,
}

const ICONS: [(AppIconVariant, &str, &[u8]); 10] = [
    (
        AppIconVariant::Pastel,
        "pastel",
        include_bytes!("../../public/app-icon/pastel.png"),
    ),
    (
        AppIconVariant::Blue,
        "blue",
        include_bytes!("../../public/app-icon/blue.png"),
    ),
    (
        AppIconVariant::Light,
        "light",
        include_bytes!("../../public/app-icon/light.png"),
    ),
    (
        AppIconVariant::Prism,
        "prism",
        include_bytes!("../../public/app-icon/prism.png"),
    ),
    (
        AppIconVariant::Iridescent,
        "iridescent",
        include_bytes!("../../public/app-icon/iridescent.png"),
    ),
    (
        AppIconVariant::Ocean,
        "ocean",
        include_bytes!("../../public/app-icon/ocean.png"),
    ),
    (
        AppIconVariant::Mint,
        "mint",
        include_bytes!("../../public/app-icon/mint.png"),
    ),
    (
        AppIconVariant::Aurora,
        "aurora",
        include_bytes!("../../public/app-icon/aurora.png"),
    ),
    (
        AppIconVariant::Sunset,
        "sunset",
        include_bytes!("../../public/app-icon/sunset.png"),
    ),
    (
        AppIconVariant::Coral,
        "coral",
        include_bytes!("../../public/app-icon/coral.png"),
    ),
];

impl AppIconVariant {
    pub(crate) const ALL: [Self; ICONS.len()] = {
        let mut all = [Self::Pastel; ICONS.len()];
        let mut index = 0;
        while index < ICONS.len() {
            all[index] = ICONS[index].0;
            index += 1;
        }
        all
    };

    pub(crate) fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|variant| variant.id() == value)
    }

    fn index(self) -> usize {
        self as usize
    }

    pub(crate) fn id(self) -> &'static str {
        ICONS[self.index()].1
    }

    pub(crate) fn png(self) -> &'static [u8] {
        ICONS[self.index()].2
    }
}

static CURRENT: RwLock<AppIconVariant> = RwLock::new(AppIconVariant::Pastel);

#[cfg(any(not(target_os = "macos"), test))]
pub(crate) fn current() -> AppIconVariant {
    *CURRENT.read().unwrap_or_else(PoisonError::into_inner)
}

fn replace_current(variant: AppIconVariant) -> bool {
    let mut current = CURRENT.write().unwrap_or_else(PoisonError::into_inner);
    let changed = *current != variant;
    *current = variant;
    changed
}

#[tauri::command]
pub fn app_icon_set<R: Runtime>(app: AppHandle<R>, variant: String) -> Result<(), String> {
    let chosen = AppIconVariant::parse(&variant).ok_or_else(|| {
        crate::app_error::AppError::new("settings.app_icon_unsupported").param("icon", &variant)
    })?;
    if replace_current(chosen) {
        apply(&app, chosen);
    }
    Ok(())
}

fn apply<R: Runtime>(app: &AppHandle<R>, variant: AppIconVariant) {
    #[cfg(target_os = "macos")]
    mac::set_application_icon(app, variant);
    #[cfg(not(target_os = "macos"))]
    windowed::set_every_window_icon(app, variant);
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Rgba {
    pub(crate) pixels: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

pub(crate) fn decode_png(bytes: &[u8]) -> Option<Rgba> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().ok()?;
    let mut pixels = vec![0; reader.output_buffer_size()?];
    let frame = reader.next_frame(&mut pixels).ok()?;
    if frame.color_type != png::ColorType::Rgba || frame.bit_depth != png::BitDepth::Eight {
        return None;
    }
    pixels.truncate(frame.buffer_size());
    Some(Rgba {
        pixels,
        width: frame.width,
        height: frame.height,
    })
}

#[cfg(any(windows, test))]
pub(crate) fn shrink(image: &Rgba, edge: u32) -> Option<Rgba> {
    if edge == 0 || image.width != image.height || !image.width.is_multiple_of(edge) {
        return None;
    }
    let factor = (image.width / edge) as usize;
    let source_width = image.width as usize;
    let side = edge as usize;
    let count = (factor * factor) as u64;
    let mut pixels = Vec::with_capacity(side * side * 4);
    for row in 0..side {
        for column in 0..side {
            let mut colour = [0u64; 3];
            let mut alpha = 0u64;
            for y in row * factor..(row + 1) * factor {
                for x in column * factor..(column + 1) * factor {
                    let at = (y * source_width + x) * 4;
                    let weight = u64::from(image.pixels[at + 3]);
                    for (sum, value) in colour.iter_mut().zip(&image.pixels[at..at + 3]) {
                        *sum += u64::from(*value) * weight;
                    }
                    alpha += weight;
                }
            }
            pixels.extend(colour.iter().map(|sum| {
                (sum + alpha / 2)
                    .checked_div(alpha)
                    .map_or(0, |value| u8::try_from(value).unwrap_or(u8::MAX))
            }));
            pixels.push(u8::try_from((alpha + count / 2) / count).unwrap_or(u8::MAX));
        }
    }
    Some(Rgba {
        pixels,
        width: edge,
        height: edge,
    })
}

#[cfg(any(target_os = "macos", windows, test))]
pub(crate) fn encode_png(image: &Rgba) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, image.width, image.height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().ok()?;
    writer.write_image_data(&image.pixels).ok()?;
    writer.finish().ok()?;
    Some(bytes)
}

/// Apple's grid for macOS app icons. macOS 15 and earlier draw an icon
/// exactly as given, so a tile that fills its canvas shows larger than every
/// other app in the Dock and Finder. macOS 26 refits such a tile itself.
#[cfg(any(target_os = "macos", test))]
pub(crate) mod macos_grid {
    use super::Rgba;

    /// In a 1024 px canvas: an 824 px tile with a 185.4 px corner radius,
    /// centred, over a 30% black shadow dropped 10 px and blurred by 10 px.
    const TILE: f64 = 824.0 / 1024.0;
    const RADIUS: f64 = 185.4 / 1024.0;
    const SHADOW_DROP: f64 = 10.0 / 1024.0;
    const SHADOW_BLUR: f64 = 10.0 / 1024.0;
    const SHADOW_OPACITY: f64 = 0.3;

    pub(crate) fn frame(image: &Rgba) -> Option<Rgba> {
        if image.width == 0 || image.width != image.height {
            return None;
        }
        let edge = image.width as usize;
        let canvas = f64::from(image.width);
        let side = (canvas * TILE).round() as usize;
        let inset = (edge - side) / 2;
        let tile = resample(image, side);
        let half = side as f64 / 2.0;
        let centre = inset as f64 + half;
        let radius = canvas * RADIUS;
        let drop = canvas * SHADOW_DROP;
        let mut shadow: Vec<f64> = (0..edge * edge)
            .map(|at| {
                let (x, y) = ((at % edge) as f64 + 0.5, (at / edge) as f64 + 0.5);
                coverage(x, y - drop, centre, half, radius)
            })
            .collect();
        blur(&mut shadow, edge, canvas * SHADOW_BLUR);
        let mut pixels = Vec::with_capacity(edge * edge * 4);
        for y in 0..edge {
            for x in 0..edge {
                let within =
                    (inset..inset + side).contains(&x) && (inset..inset + side).contains(&y);
                let inside = coverage(x as f64 + 0.5, y as f64 + 0.5, centre, half, radius);
                let [red, green, blue, alpha] = if within && inside > 0.0 {
                    tile[(y - inset) * side + (x - inset)].map(|value| value * inside)
                } else {
                    [0.0; 4]
                };
                let total = alpha + shadow[y * edge + x] * SHADOW_OPACITY * (1.0 - alpha);
                let straight = |value: f64| if total > 0.0 { value / total } else { 0.0 };
                pixels.extend(
                    [straight(red), straight(green), straight(blue), total]
                        .map(|value| (value * 255.0).round().clamp(0.0, 255.0) as u8),
                );
            }
        }
        Some(Rgba {
            pixels,
            width: image.width,
            height: image.height,
        })
    }

    fn coverage(x: f64, y: f64, centre: f64, half: f64, radius: f64) -> f64 {
        let dx = (x - centre).abs() - (half - radius);
        let dy = (y - centre).abs() - (half - radius);
        let distance = dx.max(0.0).hypot(dy.max(0.0)) + dx.max(dy).min(0.0) - radius;
        (0.5 - distance).clamp(0.0, 1.0)
    }

    fn resample(image: &Rgba, side: usize) -> Vec<[f64; 4]> {
        let edge = image.width as usize;
        let source: Vec<[f64; 4]> = image
            .pixels
            .as_chunks::<4>()
            .0
            .iter()
            .map(|&[red, green, blue, alpha]| {
                let alpha = f64::from(alpha) / 255.0;
                let colour = |value: u8| f64::from(value) / 255.0 * alpha;
                [colour(red), colour(green), colour(blue), alpha]
            })
            .collect();
        let taps = area_taps(edge, side);
        let mut rows = Vec::with_capacity(edge * side);
        for y in 0..edge {
            for column in &taps {
                rows.push(weighted(column, |x| source[y * edge + x]));
            }
        }
        let mut tile = Vec::with_capacity(side * side);
        for row in &taps {
            for x in 0..side {
                tile.push(weighted(row, |y| rows[y * side + x]));
            }
        }
        tile
    }

    fn weighted(taps: &[(usize, f64)], pixel: impl Fn(usize) -> [f64; 4]) -> [f64; 4] {
        let mut sum = [0.0; 4];
        for &(at, weight) in taps {
            for (total, value) in sum.iter_mut().zip(pixel(at)) {
                *total += value * weight;
            }
        }
        sum
    }

    fn area_taps(from: usize, to: usize) -> Vec<Vec<(usize, f64)>> {
        let scale = from as f64 / to as f64;
        (0..to)
            .map(|index| {
                let start = index as f64 * scale;
                let end = start + scale;
                (start.floor() as usize..(end.ceil() as usize).min(from))
                    .map(|source| {
                        let overlap = end.min(source as f64 + 1.0) - start.max(source as f64);
                        (source, overlap / scale)
                    })
                    .collect()
            })
            .collect()
    }

    fn blur(plane: &mut [f64], edge: usize, sigma: f64) {
        let reach = (sigma * 3.0).ceil() as usize;
        let mut kernel: Vec<f64> = (0..=2 * reach)
            .map(|index| {
                let distance = index as f64 - reach as f64;
                (-distance * distance / (2.0 * sigma * sigma)).exp()
            })
            .collect();
        let total: f64 = kernel.iter().sum();
        kernel.iter_mut().for_each(|weight| *weight /= total);
        let span = |at: usize| at.saturating_sub(reach)..=(at + reach).min(edge - 1);
        let mut across = vec![0.0; plane.len()];
        for y in 0..edge {
            for x in 0..edge {
                across[y * edge + x] = span(x)
                    .map(|source| plane[y * edge + source] * kernel[source + reach - x])
                    .sum();
            }
        }
        for y in 0..edge {
            for x in 0..edge {
                plane[y * edge + x] = span(y)
                    .map(|source| across[source * edge + x] * kernel[source + reach - y])
                    .sum();
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) use windowed::plugin;

#[cfg(not(target_os = "macos"))]
mod windowed {
    use std::sync::OnceLock;

    use tauri::image::Image;
    use tauri::{AppHandle, Manager, Runtime, Window};

    use super::{current, decode_png, AppIconVariant, Rgba};

    #[cfg(windows)]
    const WINDOW_ICON_EDGE: u32 = 64;

    pub(crate) fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
        tauri::plugin::Builder::new("oleafly-app-icon")
            .on_window_ready(|window| {
                let variant = current();
                if variant != AppIconVariant::default() {
                    set_window_icon(&window, variant);
                }
            })
            .build()
    }

    pub(super) fn set_every_window_icon<R: Runtime>(app: &AppHandle<R>, variant: AppIconVariant) {
        for window in app.windows().into_values() {
            set_window_icon(&window, variant);
        }
    }

    fn set_window_icon<R: Runtime>(window: &Window<R>, variant: AppIconVariant) {
        let default_icon = if variant == AppIconVariant::default() {
            window.app_handle().default_window_icon().cloned()
        } else {
            None
        };
        if let Some(icon) = default_icon.or_else(|| window_image(variant)) {
            let _ = window.set_icon(icon);
        }
    }

    fn window_image(variant: AppIconVariant) -> Option<Image<'static>> {
        static IMAGES: [OnceLock<Option<Rgba>>; AppIconVariant::ALL.len()] =
            [const { OnceLock::new() }; AppIconVariant::ALL.len()];
        let rgba = IMAGES[variant.index()]
            .get_or_init(|| decode_png(variant.png()).map(window_sized))
            .as_ref()?;
        Some(Image::new(&rgba.pixels, rgba.width, rgba.height))
    }

    #[cfg(windows)]
    fn window_sized(image: Rgba) -> Rgba {
        super::shrink(&image, WINDOW_ICON_EDGE).unwrap_or(image)
    }

    #[cfg(not(windows))]
    fn window_sized(image: Rgba) -> Rgba {
        image
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::OnceLock;

    use tauri::{AppHandle, Runtime};

    use super::{decode_png, encode_png, macos_grid, AppIconVariant};

    pub(super) fn set_application_icon<R: Runtime>(app: &AppHandle<R>, variant: AppIconVariant) {
        let Some(bytes) = dock_png(variant) else {
            return;
        };
        let _ = app.run_on_main_thread(move || {
            use objc2::rc::autoreleasepool;
            use objc2::{AllocAnyThread, MainThreadMarker};
            use objc2_app_kit::{NSApplication, NSImage};
            use objc2_foundation::NSData;

            let Some(main_thread) = MainThreadMarker::new() else {
                return;
            };
            autoreleasepool(|_| {
                let data = NSData::with_bytes(bytes);
                let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
                    return;
                };
                let application = NSApplication::sharedApplication(main_thread);
                unsafe { application.setApplicationIconImage(Some(&image)) };
            });
        });
    }

    /// The icon on Apple's grid. The Dock draws the image as given, and the
    /// PNGs fill their canvas.
    fn dock_png(variant: AppIconVariant) -> Option<&'static [u8]> {
        static PNGS: [OnceLock<Option<Vec<u8>>>; AppIconVariant::ALL.len()] =
            [const { OnceLock::new() }; AppIconVariant::ALL.len()];
        PNGS[variant.index()]
            .get_or_init(|| encode_png(&macos_grid::frame(&decode_png(variant.png())?)?))
            .as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    fn pixel(image: &Rgba, x: u32, y: u32) -> [u8; 4] {
        let at = ((y * image.width + x) * 4) as usize;
        [
            image.pixels[at],
            image.pixels[at + 1],
            image.pixels[at + 2],
            image.pixels[at + 3],
        ]
    }

    #[test]
    fn parses_every_icon_name_and_nothing_else() {
        assert_eq!(AppIconVariant::parse("blue"), Some(AppIconVariant::Blue));
        assert_eq!(AppIconVariant::parse("light"), Some(AppIconVariant::Light));
        assert_eq!(
            AppIconVariant::parse("iridescent"),
            Some(AppIconVariant::Iridescent)
        );
        for refused in [
            "",
            "Blue",
            "LIGHT",
            " blue",
            "green",
            "default",
            "dark",
            "violet",
            "deep-space",
        ] {
            assert_eq!(AppIconVariant::parse(refused), None, "{refused:?}");
        }
        for variant in AppIconVariant::ALL {
            assert_eq!(AppIconVariant::parse(variant.id()), Some(variant));
        }
        assert_eq!(AppIconVariant::default(), AppIconVariant::Pastel);
    }

    #[test]
    fn the_table_lists_each_icon_once_in_declaration_order() {
        assert_eq!(AppIconVariant::ALL.len(), 10);
        for (index, (variant, _, _)) in ICONS.iter().enumerate() {
            assert_eq!(variant.index(), index, "{variant:?}");
        }
        let mut ids: Vec<_> = AppIconVariant::ALL.iter().map(|v| v.id()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), AppIconVariant::ALL.len());
    }

    #[test]
    fn every_icon_is_a_512_pixel_rgba_png() {
        for variant in AppIconVariant::ALL {
            let bytes = variant.png();
            assert_eq!(bytes[..8], PNG_SIGNATURE, "{variant:?}");
            let image = decode_png(bytes).expect("the icon decodes as 8-bit RGBA");
            assert_eq!((image.width, image.height), (512, 512), "{variant:?}");
            assert_eq!(image.pixels.len(), 512 * 512 * 4);
            assert_eq!(pixel(&image, 0, 0)[3], 0, "{variant:?} has rounded corners");
            assert_eq!(
                pixel(&image, 256, 256)[3],
                255,
                "{variant:?} is opaque inside"
            );
        }
        for (index, first) in AppIconVariant::ALL.iter().enumerate() {
            for second in &AppIconVariant::ALL[index + 1..] {
                assert_ne!(first.png(), second.png(), "{first:?} and {second:?}");
            }
        }
    }

    #[test]
    fn the_blue_icon_has_a_blue_tile_and_every_other_icon_a_light_one() {
        let blue = decode_png(AppIconVariant::Blue.png()).unwrap();
        let [red, green, blue_channel, _] = pixel(&blue, 256, 480);
        assert!(
            red.abs_diff(47) <= 2 && green.abs_diff(111) <= 2 && blue_channel.abs_diff(219) <= 2
        );
        for variant in AppIconVariant::ALL
            .iter()
            .filter(|variant| **variant != AppIconVariant::Blue)
        {
            let image = decode_png(variant.png()).unwrap();
            let [red, green, blue_channel, _] = pixel(&image, 256, 480);
            assert!(
                red >= 225 && green >= 225 && blue_channel >= 225,
                "{variant:?} tile is {red},{green},{blue_channel}"
            );
        }
    }

    #[test]
    fn refuses_bytes_that_are_not_a_png() {
        assert_eq!(decode_png(b""), None);
        assert_eq!(decode_png(b"not a png at all"), None);
        assert_eq!(decode_png(&AppIconVariant::Blue.png()[..64]), None);
    }

    #[test]
    fn shrinking_weights_colour_by_coverage() {
        let image = Rgba {
            pixels: vec![200, 10, 20, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            width: 2,
            height: 2,
        };
        let shrunk = shrink(&image, 1).unwrap();
        assert_eq!(shrunk.pixels, vec![200, 10, 20, 64]);
        assert_eq!((shrunk.width, shrunk.height), (1, 1));
        assert_eq!(shrink(&image, 3), None);
        assert_eq!(shrink(&image, 0), None);
    }

    #[test]
    fn shrinks_the_icons_to_a_window_icon() {
        for variant in AppIconVariant::ALL {
            let image = decode_png(variant.png()).unwrap();
            let small = shrink(&image, 64).unwrap();
            assert_eq!((small.width, small.height), (64, 64));
            assert_eq!(small.pixels.len(), 64 * 64 * 4);
            assert_eq!(pixel(&small, 0, 0)[3], 0);
            assert_eq!(pixel(&small, 32, 32)[3], 255);
        }
    }

    #[test]
    fn refuses_an_unknown_icon_with_a_translated_error() {
        let app = tauri::test::mock_app();
        let error = app_icon_set(app.handle().clone(), "green".to_string()).unwrap_err();
        assert!(error.contains("settings.app_icon_unsupported"), "{error}");
        assert_eq!(
            crate::app_error::english(&error).as_deref(),
            Some("The app icon green is not available.")
        );
    }

    #[test]
    fn remembers_the_chosen_icon_and_reports_only_changes() {
        assert_eq!(current(), AppIconVariant::Pastel);
        assert!(!replace_current(AppIconVariant::Pastel));
        assert!(replace_current(AppIconVariant::Blue));
        assert_eq!(current(), AppIconVariant::Blue);
        assert!(!replace_current(AppIconVariant::Blue));
        assert!(replace_current(AppIconVariant::Pastel));
        assert_eq!(current(), AppIconVariant::Pastel);
    }

    fn icns_png_layers(icns: &[u8]) -> Vec<([u8; 4], Rgba)> {
        assert_eq!(&icns[..4], b"icns");
        let mut layers = Vec::new();
        let mut at = 8;
        while at + 8 <= icns.len() {
            let kind: [u8; 4] = icns[at..at + 4].try_into().unwrap();
            let length = u32::from_be_bytes(icns[at + 4..at + 8].try_into().unwrap()) as usize;
            let data = &icns[at + 8..at + length];
            if data.starts_with(&PNG_SIGNATURE) {
                let image = decode_png(data).expect("an icns PNG layer decodes as RGBA");
                layers.push((kind, image));
            }
            at += length;
        }
        layers
    }

    /// Checks that `image` leaves Apple's margin: an 824/1024 tile centred in
    /// the canvas, transparent beyond it, opaque in the middle.
    fn assert_on_macos_grid(image: &Rgba, label: &str) {
        let edge = image.width;
        assert_eq!(image.height, edge, "{label} is square");
        let margin = edge * 100 / 1024;
        let middle = edge / 2;
        for (x, y) in [
            (middle, margin / 2),
            (middle, edge - 1 - margin / 2),
            (margin / 2, middle),
            (edge - 1 - margin / 2, middle),
        ] {
            assert!(
                pixel(image, x, y)[3] <= 2,
                "{label} ({edge} px) is drawn at ({x}, {y}), inside the margin macOS leaves round every icon"
            );
        }
        assert_eq!(
            pixel(image, middle, middle)[3],
            255,
            "{label} is opaque inside"
        );
        let solid: Vec<u32> = (0..edge)
            .filter(|&x| pixel(image, x, middle)[3] >= 128)
            .collect();
        let width = solid.last().unwrap() - solid.first().unwrap() + 1;
        let expected = f64::from(edge) * 824.0 / 1024.0;
        assert!(
            (f64::from(width) - expected).abs() <= 1.0,
            "{label} ({edge} px) tile is {width} px wide, macOS expects {expected}"
        );
    }

    #[test]
    fn the_bundled_macos_icon_leaves_the_macos_margin() {
        let icns = include_bytes!("../icons/icon.icns");
        let layers = icns_png_layers(icns);
        assert!(
            layers.len() >= 6,
            "icon.icns has {} PNG layers",
            layers.len()
        );
        for (kind, image) in &layers {
            assert_on_macos_grid(image, &String::from_utf8_lossy(kind));
        }
        let edges: Vec<u32> = layers.iter().map(|(_, image)| image.width).collect();
        assert!(
            edges.contains(&1024),
            "icon.icns has a 1024 px layer: {edges:?}"
        );
    }

    #[test]
    fn the_bundled_macos_icon_is_the_master_on_the_macos_grid() {
        let master = decode_png(include_bytes!("../icons/app-icon.png")).unwrap();
        assert_eq!((master.width, master.height), (1024, 1024));
        let default = decode_png(AppIconVariant::default().png()).unwrap();
        let half = shrink(&master, 512).unwrap();
        for (x, y) in [(256, 480), (256, 256), (140, 400), (380, 120), (60, 60)] {
            let (want, got) = (pixel(&default, x, y), pixel(&half, x, y));
            for (want, got) in want.iter().zip(got) {
                assert!(
                    want.abs_diff(got) <= 6,
                    "app-icon.png is the default icon at ({x}, {y})"
                );
            }
        }
        let tile = macos_grid::frame(&master).unwrap();
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/icons/icon.icns");
        if std::env::var_os("OLEAFLY_WRITE_GOLDENS").is_some() {
            write_icns(&tile, path);
        }
        for (kind, layer) in icns_png_layers(&std::fs::read(path).unwrap()) {
            let expected = shrink(&tile, layer.width).unwrap();
            let differs = expected
                .pixels
                .iter()
                .zip(&layer.pixels)
                .filter(|(want, got)| want.abs_diff(**got) > 2)
                .count();
            assert_eq!(
                differs,
                0,
                "{} is not app-icon.png on the macOS grid; rebuild icon.icns with OLEAFLY_WRITE_GOLDENS=1",
                String::from_utf8_lossy(&kind)
            );
        }
    }

    #[cfg(target_os = "macos")]
    fn write_icns(tile: &Rgba, path: &str) {
        let iconset = tempfile::Builder::new()
            .suffix(".iconset")
            .tempdir()
            .unwrap();
        for (name, edge) in [
            ("16x16", 16),
            ("16x16@2x", 32),
            ("32x32", 32),
            ("32x32@2x", 64),
            ("128x128", 128),
            ("128x128@2x", 256),
            ("256x256", 256),
            ("256x256@2x", 512),
            ("512x512", 512),
            ("512x512@2x", 1024),
        ] {
            let png = encode_png(&shrink(tile, edge).unwrap()).unwrap();
            std::fs::write(iconset.path().join(format!("icon_{name}.png")), png).unwrap();
        }
        let status = std::process::Command::new("iconutil")
            .args(["-c", "icns", "-o", path])
            .arg(iconset.path())
            .status()
            .expect("iconutil runs");
        assert!(status.success(), "iconutil failed: {status}");
    }

    #[cfg(not(target_os = "macos"))]
    fn write_icns(_tile: &Rgba, _path: &str) {
        panic!("icon.icns is rebuilt with iconutil, which only macOS has");
    }

    #[test]
    fn every_icon_on_the_macos_grid_leaves_the_macos_margin() {
        for variant in AppIconVariant::ALL {
            let image = decode_png(variant.png()).unwrap();
            let framed = macos_grid::frame(&image).unwrap();
            assert_eq!((framed.width, framed.height), (512, 512));
            assert_on_macos_grid(&framed, variant.id());
            let (source, kept) = (pixel(&image, 256, 256), pixel(&framed, 256, 256));
            for (want, got) in source.iter().zip(kept) {
                assert!(want.abs_diff(got) <= 3, "{variant:?} keeps its colours");
            }
            let shadow = pixel(&framed, 256, 465)[3];
            assert!(
                (1..128).contains(&shadow),
                "{variant:?} has a faint shadow under the tile, not {shadow}"
            );
            assert!(
                pixel(&framed, 72, 72)[3] < 64,
                "{variant:?} rounds its corners as much as macOS icons do"
            );
        }
    }

    #[test]
    fn framing_refuses_an_image_that_is_not_square() {
        let wide = Rgba {
            pixels: vec![255; 2 * 4],
            width: 2,
            height: 1,
        };
        assert_eq!(macos_grid::frame(&wide), None);
        let empty = Rgba {
            pixels: Vec::new(),
            width: 0,
            height: 0,
        };
        assert_eq!(macos_grid::frame(&empty), None);
    }

    #[test]
    fn an_encoded_png_decodes_to_the_same_pixels() {
        let image = decode_png(AppIconVariant::Blue.png()).unwrap();
        assert_eq!(decode_png(&encode_png(&image).unwrap()), Some(image));
    }

    #[test]
    fn the_bundled_icon_is_the_default_choice() {
        let bundled = decode_png(include_bytes!("../icons/icon.png")).unwrap();
        let chosen = decode_png(AppIconVariant::default().png()).unwrap();
        assert_eq!(
            (bundled.width, bundled.height),
            (chosen.width, chosen.height)
        );
        for (x, y) in [(256, 480), (256, 256), (140, 400), (380, 120), (60, 60)] {
            let expected = pixel(&chosen, x, y);
            let actual = pixel(&bundled, x, y);
            for (want, got) in expected.iter().zip(actual) {
                assert!(
                    want.abs_diff(got) <= 6,
                    "({x}, {y}) {expected:?} vs {actual:?}"
                );
            }
        }
    }
}
