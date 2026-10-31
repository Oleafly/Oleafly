//! The browser app's SyncTeX: `oleafly_synctex` built for WebAssembly behind
//! a small C ABI, which `web/src/synctex` drives without a bindings
//! generator. The page copies bytes in through `synctex_alloc`, and every
//! call returns a status, leaving its JSON answer or its error message in
//! one output buffer (`synctex_output_ptr`, `synctex_output_len`) that the
//! next call replaces.
//!
//! `synctex_open` returns an index handle above zero. `synctex_forward` and
//! `synctex_inverse` return 1 with a hit in the output, or 0 when nothing
//! matches. A failure is one of the negative `STATUS_*` codes. Nothing here
//! panics on bad input: the module is built with `panic = "abort"`, where a
//! panic would be a trap that takes the whole module down.
use std::cell::RefCell;
use std::collections::BTreeMap;

use oleafly_synctex::{
    forward_hit, gunzip, infer_roots, inverse, map_source_line, parse, Doc, GunzipError,
    MAX_SYNCTEX_FILE_BYTES, MAX_SYNCTEX_TEXT_BYTES,
};

pub const STATUS_BAD_INPUT: i32 = -1;
pub const STATUS_FILE_TOO_LARGE: i32 = -2;
pub const STATUS_TEXT_TOO_LARGE: i32 = -3;
pub const STATUS_UNREADABLE: i32 = -4;
pub const STATUS_CLOSED: i32 = -5;
pub const STATUS_INTERNAL: i32 = -6;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub status: i32,
    pub message: String,
}

impl Failure {
    fn new(status: i32, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl From<GunzipError> for Failure {
    fn from(error: GunzipError) -> Self {
        let status = match error {
            GunzipError::FileTooLarge => STATUS_FILE_TOO_LARGE,
            GunzipError::TextTooLarge => STATUS_TEXT_TOO_LARGE,
            GunzipError::Unreadable(_) => STATUS_UNREADABLE,
        };
        Self::new(status, error.to_string())
    }
}

pub struct Index {
    doc: Doc,
    roots: Vec<String>,
}

impl Index {
    pub fn open(gz: &[u8], project_paths: &[u8]) -> Result<Self, Failure> {
        Self::open_limited(
            gz,
            project_paths,
            MAX_SYNCTEX_FILE_BYTES,
            MAX_SYNCTEX_TEXT_BYTES,
        )
    }

    fn open_limited(
        gz: &[u8],
        project_paths: &[u8],
        max_file_bytes: u64,
        max_text_bytes: u64,
    ) -> Result<Self, Failure> {
        let paths: Vec<String> = serde_json::from_slice(project_paths).map_err(|error| {
            Failure::new(
                STATUS_BAD_INPUT,
                format!("The project paths aren't a JSON list of strings: {error}"),
            )
        })?;
        let doc = parse(&gunzip(gz, max_file_bytes, max_text_bytes)?);
        let roots = infer_roots(&doc, &paths);
        Ok(Self { doc, roots })
    }

    pub fn roots(&self) -> &[String] {
        &self.roots
    }

    pub fn forward(&self, file: &str, line: i32) -> Result<Option<Vec<u8>>, Failure> {
        to_json(forward_hit(&self.doc, file, line, &self.roots))
    }

    pub fn inverse(&self, page: i32, x: f64, y: f64) -> Result<Option<Vec<u8>>, Failure> {
        if !x.is_finite() || !y.is_finite() {
            return Err(Failure::new(
                STATUS_BAD_INPUT,
                "The point to look up isn't a pair of finite numbers.",
            ));
        }
        to_json(inverse(&self.doc, page, x, y, &self.roots))
    }
}

fn to_json<T: serde::Serialize>(hit: Option<T>) -> Result<Option<Vec<u8>>, Failure> {
    hit.map(|hit| {
        serde_json::to_vec(&hit).map_err(|error| Failure::new(STATUS_INTERNAL, error.to_string()))
    })
    .transpose()
}

struct State {
    indexes: BTreeMap<i32, Index>,
    last: i32,
    output: Vec<u8>,
}

impl State {
    const fn new() -> Self {
        Self {
            indexes: BTreeMap::new(),
            last: 0,
            output: Vec::new(),
        }
    }

    fn next_handle(&mut self) -> i32 {
        loop {
            self.last = if self.last == i32::MAX {
                1
            } else {
                self.last + 1
            };
            if !self.indexes.contains_key(&self.last) {
                return self.last;
            }
        }
    }

    fn answer(&mut self, result: Result<Option<Vec<u8>>, Failure>) -> i32 {
        match result {
            Ok(Some(json)) => {
                self.output = json;
                1
            }
            Ok(None) => {
                self.output.clear();
                0
            }
            Err(failure) => {
                self.output = failure.message.into_bytes();
                failure.status
            }
        }
    }
}

thread_local! {
    static STATE: RefCell<State> = const { RefCell::new(State::new()) };
}

fn with_state(call: impl FnOnce(&mut State) -> i32) -> i32 {
    STATE
        .try_with(|cell| {
            cell.try_borrow_mut()
                .map_or(STATUS_INTERNAL, |mut state| call(&mut state))
        })
        .unwrap_or(STATUS_INTERNAL)
}

fn closed() -> Failure {
    Failure::new(
        STATUS_CLOSED,
        "This SyncTeX index was closed, or never opened.",
    )
}

pub fn open(gz: &[u8], project_paths: &[u8]) -> i32 {
    let opened = Index::open(gz, project_paths);
    with_state(|state| match opened {
        Ok(index) => {
            let handle = state.next_handle();
            state.indexes.insert(handle, index);
            state.output.clear();
            handle
        }
        Err(failure) => state.answer(Err(failure)),
    })
}

pub fn forward(handle: i32, file: &[u8], line: i32) -> i32 {
    with_state(|state| {
        let result = match (state.indexes.get(&handle), std::str::from_utf8(file)) {
            (None, _) => Err(closed()),
            (Some(_), Err(_)) => Err(Failure::new(STATUS_BAD_INPUT, "The file name isn't UTF-8.")),
            (Some(index), Ok(file)) => index.forward(file, line),
        };
        state.answer(result)
    })
}

pub fn inverse_at(handle: i32, page: i32, x: f64, y: f64) -> i32 {
    with_state(|state| {
        let result = match state.indexes.get(&handle) {
            None => Err(closed()),
            Some(index) => index.inverse(page, x, y),
        };
        state.answer(result)
    })
}

pub fn close(handle: i32) -> i32 {
    with_state(|state| {
        let result = match state.indexes.remove(&handle) {
            Some(_) => Ok(None),
            None => Err(closed()),
        };
        state.answer(result)
    })
}

pub fn map_line(compiled: &[u8], current: &[u8], line: i32, current_to_compiled: bool) -> i32 {
    let mapped = match (
        std::str::from_utf8(compiled),
        std::str::from_utf8(current),
        usize::try_from(line),
    ) {
        (Ok(compiled), Ok(current), Ok(line)) if line > 0 => to_json(map_source_line(
            compiled,
            current,
            line,
            current_to_compiled,
        )),
        _ => Err(Failure::new(
            STATUS_BAD_INPUT,
            "The source texts aren't UTF-8 or the line isn't above zero.",
        )),
    };
    with_state(|state| state.answer(mapped))
}

fn bad_pointer() -> i32 {
    with_state(|state| {
        state.answer(Err(Failure::new(
            STATUS_BAD_INPUT,
            "A buffer pointer was null.",
        )))
    })
}

/// # Safety
/// `ptr` is null or points to `len` readable bytes that outlive the call.
unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if len == 0 {
        return Some(&[]);
    }
    if ptr.is_null() {
        return None;
    }
    // SAFETY: the caller promises `len` readable bytes at `ptr`.
    Some(unsafe { std::slice::from_raw_parts(ptr, len) })
}

#[no_mangle]
pub extern "C" fn synctex_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::NonNull::dangling().as_ptr();
    }
    match std::alloc::Layout::array::<u8>(len) {
        // SAFETY: the layout has a non-zero size.
        Ok(layout) => unsafe { std::alloc::alloc(layout) },
        Err(_) => std::ptr::null_mut(),
    }
}

/// # Safety
/// `ptr` and `len` come from one `synctex_alloc` call, freed once.
#[no_mangle]
pub unsafe extern "C" fn synctex_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    if let Ok(layout) = std::alloc::Layout::array::<u8>(len) {
        // SAFETY: the caller passes back what `synctex_alloc` gave out.
        unsafe { std::alloc::dealloc(ptr, layout) }
    }
}

/// # Safety
/// Each pointer is null or points to its length in readable bytes.
#[no_mangle]
pub unsafe extern "C" fn synctex_open(
    gz: *const u8,
    gz_len: usize,
    project_paths: *const u8,
    project_paths_len: usize,
) -> i32 {
    // SAFETY: passed on from the caller.
    match unsafe { (bytes(gz, gz_len), bytes(project_paths, project_paths_len)) } {
        (Some(gz), Some(project_paths)) => open(gz, project_paths),
        _ => bad_pointer(),
    }
}

/// # Safety
/// `file` is null or points to `file_len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn synctex_forward(
    handle: i32,
    file: *const u8,
    file_len: usize,
    line: i32,
) -> i32 {
    // SAFETY: passed on from the caller.
    match unsafe { bytes(file, file_len) } {
        Some(file) => forward(handle, file, line),
        None => bad_pointer(),
    }
}

#[no_mangle]
pub extern "C" fn synctex_inverse(handle: i32, page: i32, x: f64, y: f64) -> i32 {
    inverse_at(handle, page, x, y)
}

#[no_mangle]
pub extern "C" fn synctex_close(handle: i32) -> i32 {
    close(handle)
}

#[no_mangle]
unsafe extern "C" fn synctex_map_line(
    compiled: *const u8,
    compiled_len: usize,
    current: *const u8,
    current_len: usize,
    line: i32,
    current_to_compiled: i32,
) -> i32 {
    match unsafe { (bytes(compiled, compiled_len), bytes(current, current_len)) } {
        (Some(compiled), Some(current)) => {
            map_line(compiled, current, line, current_to_compiled != 0)
        }
        _ => bad_pointer(),
    }
}

#[no_mangle]
pub extern "C" fn synctex_output_ptr() -> *const u8 {
    STATE
        .try_with(|cell| {
            cell.try_borrow()
                .map_or(std::ptr::null(), |state| state.output.as_ptr())
        })
        .unwrap_or(std::ptr::null())
}

#[no_mangle]
pub extern "C" fn synctex_output_len() -> usize {
    STATE
        .try_with(|cell| cell.try_borrow().map_or(0, |state| state.output.len()))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOOK: &[u8] =
        include_bytes!("../../oleafly-synctex/tests/fixtures/synctex/include-book.synctex.gz");
    const BOOK_PROJECT: &[u8] =
        br#"["main.tex","chapters/intro.tex","chapters/methods.tex","chapters/results.tex"]"#;

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        use flate2::{write::GzEncoder, Compression};
        use std::io::Write;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    fn output() -> String {
        let (ptr, len) = (synctex_output_ptr(), synctex_output_len());
        // SAFETY: the output buffer holds `len` bytes until the next call.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    fn native(gz: &[u8]) -> Doc {
        parse(&gunzip(gz, MAX_SYNCTEX_FILE_BYTES, MAX_SYNCTEX_TEXT_BYTES).unwrap())
    }

    #[test]
    fn an_index_answers_as_the_native_search_does_with_the_inferred_root() {
        let index = Index::open(BOOK, BOOK_PROJECT).unwrap();
        assert_eq!(index.roots(), ["/p"]);
        let doc = native(BOOK);
        let roots = vec!["/p".to_string()];
        let forward = index.forward("chapters/intro.tex", 5).unwrap().unwrap();
        let expected = forward_hit(&doc, "chapters/intro.tex", 5, &roots).unwrap();
        assert_eq!(forward, serde_json::to_vec(&expected).unwrap());
        let text = String::from_utf8(forward).unwrap();
        assert!(text.contains("\"lines\":[{"), "{text}");
        let inverse_json = index.inverse(3, 239.39, 341.77).unwrap().unwrap();
        let expected = inverse(&doc, 3, 239.39, 341.77, &roots).unwrap();
        assert_eq!(expected.file, "chapters/intro.tex");
        assert_eq!(inverse_json, serde_json::to_vec(&expected).unwrap());
        assert_eq!(index.forward("missing.tex", 1).unwrap(), None);
        assert_eq!(index.inverse(999, 100.0, 100.0).unwrap(), None);
    }

    #[test]
    fn open_reports_bad_or_oversized_input_with_its_own_status() {
        let failure = |gz: &[u8], paths: &[u8]| Index::open(gz, paths).err().unwrap();
        assert_eq!(failure(b"not gzip", b"[]").status, STATUS_UNREADABLE);
        assert_eq!(
            failure(&gzip(&[0xff, 0xfe]), b"[]").status,
            STATUS_UNREADABLE
        );
        assert_eq!(failure(BOOK, b"{\"main.tex\":1}").status, STATUS_BAD_INPUT);
        assert_eq!(failure(BOOK, b"").status, STATUS_BAD_INPUT);
        let bomb = gzip(&vec![b' '; 1 << 20]);
        let limited = |max_file, max_text| {
            Index::open_limited(&bomb, b"[]", max_file, max_text)
                .err()
                .unwrap()
        };
        let too_long = limited(1 << 20, 1024);
        assert_eq!(too_long.status, STATUS_TEXT_TOO_LARGE);
        assert!(
            too_long.message.contains("its text"),
            "{}",
            too_long.message
        );
        assert_eq!(limited(64, 1 << 30).status, STATUS_FILE_TOO_LARGE);
    }

    #[test]
    fn a_point_that_is_not_a_number_is_bad_input() {
        let index = Index::open(BOOK, BOOK_PROJECT).unwrap();
        for (x, y) in [(f64::NAN, 1.0), (1.0, f64::INFINITY)] {
            assert_eq!(index.inverse(1, x, y).unwrap_err().status, STATUS_BAD_INPUT);
        }
    }

    #[test]
    fn the_c_abi_opens_searches_and_closes_an_index() {
        let gz = synctex_alloc(BOOK.len());
        assert!(!gz.is_null());
        // SAFETY: `gz` has room for the fixture, and is freed once below.
        let handle = unsafe {
            std::ptr::copy_nonoverlapping(BOOK.as_ptr(), gz, BOOK.len());
            let handle = synctex_open(gz, BOOK.len(), BOOK_PROJECT.as_ptr(), BOOK_PROJECT.len());
            synctex_free(gz, BOOK.len());
            handle
        };
        assert!(handle > 0, "{handle}: {}", output());

        let doc = native(BOOK);
        let roots = vec!["/p".to_string()];
        let file = "chapters/intro.tex";
        // SAFETY: `file` is readable for its length.
        let found = unsafe { synctex_forward(handle, file.as_ptr(), file.len(), 5) };
        assert_eq!(found, 1, "{}", output());
        let expected = forward_hit(&doc, file, 5, &roots).unwrap();
        assert_eq!(output(), serde_json::to_string(&expected).unwrap());

        assert_eq!(synctex_inverse(handle, 3, 239.39, 341.77), 1);
        let expected = inverse(&doc, 3, 239.39, 341.77, &roots).unwrap();
        assert_eq!(output(), serde_json::to_string(&expected).unwrap());
        assert_eq!(synctex_inverse(handle, 999, 0.0, 0.0), 0);
        assert_eq!(output(), "");

        assert_eq!(synctex_close(handle), 0);
        assert_eq!(synctex_close(handle), STATUS_CLOSED);
        assert!(output().contains("closed"), "{}", output());
        assert_eq!(synctex_inverse(handle, 3, 239.39, 341.77), STATUS_CLOSED);
        // SAFETY: `file` is readable for its length.
        let after = unsafe { synctex_forward(handle, file.as_ptr(), file.len(), 5) };
        assert_eq!(after, STATUS_CLOSED);
    }

    #[test]
    fn the_c_abi_refuses_null_buffers_and_names_that_are_not_utf8() {
        // SAFETY: null pointers are what is being tested; nothing is read.
        unsafe {
            assert_eq!(
                synctex_open(std::ptr::null(), 4, b"[]".as_ptr(), 2),
                STATUS_BAD_INPUT
            );
            assert!(output().contains("null"), "{}", output());
            assert_eq!(
                synctex_open(BOOK.as_ptr(), BOOK.len(), std::ptr::null(), 0),
                STATUS_BAD_INPUT,
                "an empty project path list isn't JSON"
            );
        }
        let handle = open(BOOK, b"[]");
        assert!(handle > 0);
        let latin1 = [0x63, 0x61, 0x66, 0xe9];
        // SAFETY: `latin1` is readable for its length.
        let status = unsafe { synctex_forward(handle, latin1.as_ptr(), latin1.len(), 1) };
        assert_eq!(status, STATUS_BAD_INPUT);
        // SAFETY: as above, with a null pointer and a length.
        let status = unsafe { synctex_forward(handle, std::ptr::null(), 3, 1) };
        assert_eq!(status, STATUS_BAD_INPUT);
        assert_eq!(close(handle), 0);
    }

    #[test]
    fn handles_count_up_and_are_not_handed_out_twice() {
        let first = open(BOOK, BOOK_PROJECT);
        let second = open(BOOK, BOOK_PROJECT);
        assert!(first > 0 && second > first);
        assert_eq!(close(first), 0);
        let third = open(BOOK, BOOK_PROJECT);
        assert!(third > second);
        assert_eq!(forward(first, b"main.tex", 3), STATUS_CLOSED);
        for handle in [second, third] {
            assert_eq!(close(handle), 0);
        }
    }

    #[test]
    fn lines_map_between_the_compiled_and_the_current_source_as_the_desktop_maps_them() {
        let compiled = "alpha\nbeta\ngamma\ndelta";
        let current = "intro\nalpha\nbeta\ngamma\ndelta";
        assert_eq!(
            map_line(compiled.as_bytes(), current.as_bytes(), 4, true),
            1
        );
        assert_eq!(
            output(),
            serde_json::to_string(&map_source_line(compiled, current, 4, true)).unwrap()
        );
        assert_eq!(output(), r#"{"line":3,"exact":true}"#);
        assert_eq!(
            map_line(compiled.as_bytes(), current.as_bytes(), 2, false),
            1
        );
        assert_eq!(output(), r#"{"line":3,"exact":true}"#);
        assert_eq!(map_line(b"alpha\nbeta", b"one\ntwo", 1, true), 0);
        assert_eq!(map_line(&[0xff], b"x", 1, true), STATUS_BAD_INPUT);
        assert_eq!(map_line(b"x", b"x", 0, true), STATUS_BAD_INPUT);
        let status = unsafe {
            synctex_map_line(
                compiled.as_ptr(),
                compiled.len(),
                current.as_ptr(),
                current.len(),
                5,
                1,
            )
        };
        assert_eq!(status, 1);
        assert_eq!(output(), r#"{"line":4,"exact":true}"#);
        let missing = unsafe { synctex_map_line(std::ptr::null(), 3, current.as_ptr(), 1, 1, 1) };
        assert_eq!(missing, STATUS_BAD_INPUT);
    }

    #[test]
    fn an_empty_allocation_is_safe_to_free() {
        let empty = synctex_alloc(0);
        assert!(!empty.is_null());
        // SAFETY: freeing a zero-length buffer does nothing.
        unsafe { synctex_free(empty, 0) };
        // SAFETY: a null pointer is ignored.
        unsafe { synctex_free(std::ptr::null_mut(), 16) };
    }
}
