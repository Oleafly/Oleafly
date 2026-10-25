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

#[cfg(any(not(target_os = "macos"), test))]
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Rgba {
    pub(crate) pixels: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[cfg(any(not(target_os = "macos"), test))]
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
    use tauri::{AppHandle, Runtime};

    use super::AppIconVariant;

    pub(super) fn set_application_icon<R: Runtime>(app: &AppHandle<R>, variant: AppIconVariant) {
        let bytes = variant.png();
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
