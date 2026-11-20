//! HOST REFERENCE ORACLE ONLY: this does NOT execute Atto code or certify any backend.
//! Mirrors the versioned std.buffer range/value/endian contract in pure Rust.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Fault { Bounds, Value }
#[derive(Clone, Copy, Debug)]
enum Endian { Little, Big }

fn offset_for(len: usize, offset: i64, width: usize) -> Result<usize, Fault> {
    if offset < 0 || width > len { return Err(Fault::Bounds); }
    let at = usize::try_from(offset).map_err(|_| Fault::Bounds)?;
    if at > len - width { return Err(Fault::Bounds); }
    Ok(at)
}

fn write_uint(bytes: &mut [u8], offset: i64, width: usize, value: i64, order: Endian)
    -> Result<(), Fault>
{
    let at = offset_for(bytes.len(), offset, width)?;
    if !(1..=4).contains(&width) || value < 0 ||
        (value as u64) > ((1_u64 << (width * 8)) - 1)
    { return Err(Fault::Value); }
    let value = value as u64;
    // After all preflight checks, these writes cannot fail in the reference.
    for i in 0..width {
        let shift = 8 * match order { Endian::Little => i, Endian::Big => width - 1 - i };
        bytes[at + i] = ((value >> shift) & 255) as u8;
    }
    Ok(())
}

fn read_uint(bytes: &[u8], offset: i64, width: usize, order: Endian)
    -> Result<u64, Fault>
{
    let at = offset_for(bytes.len(), offset, width)?;
    if !(1..=4).contains(&width) { return Err(Fault::Value); }
    let mut value = 0_u64;
    for i in 0..width {
        let shift = 8 * match order { Endian::Little => i, Endian::Big => width - 1 - i };
        value |= u64::from(bytes[at + i]) << shift;
    }
    Ok(value)
}

#[test]
fn u32_endian_exact_bytes_and_zero_fill() {
    for order in [Endian::Little, Endian::Big] {
        let mut bytes = vec![0_u8; 8];
        write_uint(&mut bytes, 0, 4, 0x12345678, order).unwrap();
        match order {
            Endian::Little => assert_eq!(&bytes[..4], &[0x78, 0x56, 0x34, 0x12]),
            Endian::Big => assert_eq!(&bytes[..4], &[0x12, 0x34, 0x56, 0x78]),
        }
        assert_eq!(&bytes[4..], &[0; 4]);
        assert_eq!(read_uint(&bytes, 0, 4, order), Ok(0x12345678));
    }
}

#[test]
fn signed_limits_and_value_validation_are_fail_atomic() {
    let mut bytes = vec![0xa5_u8; 8];
    let before = bytes.clone();
    for offset in [-1, 5, i64::MAX, i64::MIN] {
        assert_eq!(write_uint(&mut bytes, offset, 4, 42, Endian::Little), Err(Fault::Bounds));
        assert_eq!(read_uint(&bytes, offset, 4, Endian::Big), Err(Fault::Bounds));
        assert_eq!(bytes, before);
    }
    for value in [-1, 4294967296, i64::MAX] {
        assert_eq!(write_uint(&mut bytes, 4, 4, value, Endian::Little), Err(Fault::Value));
        assert_eq!(bytes, before);
    }
    assert_eq!(offset_for(8, 4, 4), Ok(4));
    assert_eq!(offset_for(8, 5, 4), Err(Fault::Bounds));
    assert_eq!(offset_for(0, 0, 0), Ok(0)); // Valid empty view.
    assert_eq!(offset_for(0, 0, 1), Err(Fault::Bounds));
    assert_eq!(offset_for(usize::MAX, i64::MAX, 4), Ok(i64::MAX as usize));
}

#[test]
fn all_u8_u16_u32_values_preserve_endianness_and_unaligned_offsets() {
    let values = [(1, 255), (2, 65535), (4, 4294967295)];
    for (width, max) in values {
        for order in [Endian::Little, Endian::Big] {
            for offset in 0..=(9 - width) {
                let mut bytes = vec![0_u8; 9];
                for value in [0, 1, max / 2, max] {
                    write_uint(&mut bytes, offset as i64, width, value, order).unwrap();
                    assert_eq!(read_uint(&bytes, offset as i64, width, order), Ok(value as u64));
                }
            }
        }
    }
}

#[test]
fn stress_u32_roundtrip_is_deterministic_without_signed_promotion() {
    let mut state = 0x9e3779b97f4a7c15_u64;
    for _ in 0..100_000 {
        state ^= state << 7;
        state ^= state >> 9;
        state ^= state << 8;
        let value = (state & 0xffff_ffff) as i64;
        let mut little = [0_u8; 8];
        let mut big = [0_u8; 8];
        write_uint(&mut little, 1, 4, value, Endian::Little).unwrap();
        write_uint(&mut big, 1, 4, value, Endian::Big).unwrap();
        assert_eq!(read_uint(&little, 1, 4, Endian::Little), Ok(value as u64));
        assert_eq!(read_uint(&big, 1, 4, Endian::Big), Ok(value as u64));
        assert_eq!(&little[1..5], &big[1..5].iter().copied().rev().collect::<Vec<_>>());
    }
}
