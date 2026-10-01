//! Small benchmark ABI. All scoring data stays in Rust after one upload.
use super::{parse, score, Input};
use std::cell::RefCell;
thread_local! {
    static INPUT: RefCell<Option<Input>> = const { RefCell::new(None) };
    static ERROR: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}
fn fail(error: String) {
    ERROR.with(|cell| *cell.borrow_mut() = error.into_bytes());
}
#[no_mangle]
pub extern "C" fn benchmark_clear() {
    INPUT.with(|cell| *cell.borrow_mut() = None);
    ERROR.with(|cell| cell.borrow_mut().clear());
}
#[no_mangle]
pub extern "C" fn benchmark_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}
/// # Safety
/// `ptr` and `len` must identify an allocation returned by benchmark_alloc,
/// and must not be freed more than once.
#[no_mangle]
pub unsafe extern "C" fn benchmark_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}
/// # Safety
/// `ptr` and `len` must identify a live benchmark_alloc allocation containing
/// a UTF-8 corpus. The host retains responsibility for freeing that buffer.
#[no_mangle]
pub unsafe extern "C" fn benchmark_load(ptr: *const u8, len: usize) -> i32 {
    benchmark_clear();
    match parse(std::slice::from_raw_parts(ptr, len)) {
        Ok(input) => {
            INPUT.with(|cell| *cell.borrow_mut() = Some(input));
            1
        }
        Err(error) => {
            fail(error);
            0
        }
    }
}
#[no_mangle]
pub extern "C" fn benchmark_count() -> usize {
    INPUT.with(|cell| cell.borrow().as_ref().map_or(0, Input::roster_count))
}
#[no_mangle]
pub extern "C" fn benchmark_score(start: usize, end: usize) -> f64 {
    let result = INPUT.with(|cell| match cell.borrow().as_ref() {
        Some(input) => score(input, start, end),
        None => Err("load a corpus before scoring".into()),
    });
    match result {
        Ok(checksum) => checksum,
        Err(error) => {
            fail(error);
            f64::NAN
        }
    }
}
#[no_mangle]
pub extern "C" fn benchmark_error_ptr() -> *const u8 {
    ERROR.with(|cell| cell.borrow().as_ptr())
}
#[no_mangle]
pub extern "C" fn benchmark_error_len() -> usize {
    ERROR.with(|cell| cell.borrow().len())
}

thread_local! {
    static MODEL: RefCell<Option<super::runtime::Model>> = const { RefCell::new(None) };
    static OUTPUT: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static ROSTER: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
}
/// # Safety
/// ptr/len must identify a live benchmark_alloc allocation containing JSON.
#[no_mangle]
pub unsafe extern "C" fn scorer_load(ptr: *const u8, len: usize) -> i32 {
    MODEL.with(|cell| *cell.borrow_mut() = None);
    OUTPUT.with(|cell| cell.borrow_mut().clear());
    ERROR.with(|cell| cell.borrow_mut().clear());
    match super::runtime::Model::parse(std::slice::from_raw_parts(ptr, len)) {
        Ok(model) => {
            MODEL.with(|cell| *cell.borrow_mut() = Some(model));
            1
        }
        Err(error) => {
            fail(error);
            0
        }
    }
}
/// # Safety
/// ptr must identify a live allocation with len little-endian u32 indices.
#[no_mangle]
pub unsafe extern "C" fn scorer_evaluate(
    ptr: *const u8,
    len: usize,
    first: usize,
    last: usize,
) -> i32 {
    let Some(bytes_len) = len.checked_mul(4) else {
        fail("roster too large".into());
        return 0;
    };
    let result = ROSTER.with(|roster_cell| {
        let mut roster = roster_cell.borrow_mut();
        roster.clear();
        roster.extend(
            std::slice::from_raw_parts(ptr, bytes_len)
                .chunks_exact(4)
                .map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize),
        );
        MODEL.with(|cell| match cell.borrow_mut().as_mut() {
            Some(model) => OUTPUT
                .with(|output| model.evaluate_into(&roster, first, last, &mut output.borrow_mut())),
            None => Err("load a scoring model first".into()),
        })
    });
    match result {
        Ok(()) => 1,
        Err(error) => {
            fail(error);
            0
        }
    }
}
#[no_mangle]
pub extern "C" fn scorer_output_ptr() -> *const f64 {
    OUTPUT.with(|cell| cell.borrow().as_ptr())
}
#[no_mangle]
pub extern "C" fn scorer_output_len() -> usize {
    OUTPUT.with(|cell| cell.borrow().len())
}
#[no_mangle]
pub extern "C" fn scorer_clear() {
    ROSTER.with(|cell| cell.borrow_mut().clear());
    MODEL.with(|cell| *cell.borrow_mut() = None);
    OUTPUT.with(|cell| cell.borrow_mut().clear());
}
#[no_mangle]
pub extern "C" fn scorer_version() -> u32 {
    // 2: one-week bye fills.
    2
}
