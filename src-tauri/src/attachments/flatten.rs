use std::io::Cursor;

use png::{BitDepth, ColorType, Decoder, Encoder, Limits, Transformations};

const DECODE_LIMIT_BYTES: usize = 128 * 1024 * 1024;

pub(crate) fn png_on_white(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut decoder = Decoder::new_with_limits(
        Cursor::new(bytes),
        Limits {
            bytes: DECODE_LIMIT_BYTES,
        },
    );
    decoder.set_transformations(Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().ok()?;
    let (color, depth) = reader.output_color_type();
    let (opaque, channels) = match color {
        ColorType::Rgba => (ColorType::Rgb, 3),
        ColorType::GrayscaleAlpha => (ColorType::Grayscale, 1),
        _ => return None,
    };
    if depth != BitDepth::Eight {
        return None;
    }
    let mut pixels = vec![0; reader.output_buffer_size()?];
    let frame = reader.next_frame(&mut pixels).ok()?;
    let width = usize::try_from(frame.width).ok()?;
    let mut flattened = Vec::with_capacity(width * usize::try_from(frame.height).ok()? * channels);
    let mut see_through = false;
    for row in pixels.chunks_exact(frame.line_size) {
        for pixel in row[..width * (channels + 1)].chunks_exact(channels + 1) {
            let alpha = u32::from(pixel[channels]);
            see_through |= alpha < 255;
            flattened.extend(
                pixel[..channels]
                    .iter()
                    .map(|&value| on_white(u32::from(value), alpha)),
            );
        }
    }
    if !see_through {
        return None;
    }
    let mut out = Vec::new();
    let mut encoder = Encoder::new(&mut out, frame.width, frame.height);
    encoder.set_color(opaque);
    encoder.set_depth(BitDepth::Eight);
    let mut writer = encoder.write_header().ok()?;
    writer.write_image_data(&flattened).ok()?;
    writer.finish().ok()?;
    Some(out)
}

fn on_white(value: u32, alpha: u32) -> u8 {
    let mixed = (value * alpha + 255 * (255 - alpha) + 127) / 255;
    u8::try_from(mixed).unwrap_or(u8::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(
        width: u32,
        height: u32,
        color: ColorType,
        data: &[u8],
        trns: Option<&[u8]>,
    ) -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = Encoder::new(&mut out, width, height);
        encoder.set_color(color);
        encoder.set_depth(BitDepth::Eight);
        if color == ColorType::Indexed {
            encoder.set_palette(vec![0, 0, 0, 255, 255, 255]);
        }
        if let Some(trns) = trns {
            encoder.set_trns(trns.to_vec());
        }
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(data).unwrap();
        writer.finish().unwrap();
        out
    }

    fn decode(bytes: &[u8]) -> (ColorType, Vec<u8>) {
        let mut reader = Decoder::new(Cursor::new(bytes)).read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let frame = reader.next_frame(&mut pixels).unwrap();
        pixels.truncate(frame.buffer_size());
        (frame.color_type, pixels)
    }

    #[test]
    fn black_text_on_a_transparent_background_stays_readable() {
        let source = encode(
            3,
            1,
            ColorType::Rgba,
            &[0, 0, 0, 0, 0, 0, 0, 255, 200, 100, 0, 128],
            None,
        );
        let (color, pixels) = decode(&png_on_white(&source).unwrap());
        assert_eq!(color, ColorType::Rgb);
        assert_eq!(pixels, vec![255, 255, 255, 0, 0, 0, 227, 177, 127]);
    }

    #[test]
    fn grey_with_alpha_and_palette_transparency_are_flattened() {
        let grey = encode(2, 1, ColorType::GrayscaleAlpha, &[0, 0, 0, 255], None);
        assert_eq!(
            decode(&png_on_white(&grey).unwrap()),
            (ColorType::Grayscale, vec![255, 0])
        );
        let palette = encode(2, 1, ColorType::Indexed, &[0, 1], Some(&[0]));
        assert_eq!(
            decode(&png_on_white(&palette).unwrap()),
            (ColorType::Rgb, vec![255, 255, 255, 255, 255, 255])
        );
    }

    #[test]
    fn opaque_images_and_other_formats_are_left_alone() {
        let rgb = encode(1, 1, ColorType::Rgb, &[10, 20, 30], None);
        assert_eq!(png_on_white(&rgb), None);
        let solid = encode(1, 1, ColorType::Rgba, &[10, 20, 30, 255], None);
        assert_eq!(png_on_white(&solid), None);
        assert_eq!(png_on_white(b"\xff\xd8\xff\xe0 not a png"), None);
    }
}
