# String and C String ABI v1

Status: proposed cross-backend semantic/ABI contract. Passing the source-free
oracle proves only that this contract is internally consistent; each backend
must separately execute its real compiler/runtime tests at an exact revision.

## Native Oreslang string

An Oreslang `string` is an immutable sequence of well-formed Unicode scalar
values whose canonical interchange/native encoding is UTF-8.

At every byte-oriented ABI boundary the value is represented by an explicit
byte span:

```text
Utf8StringSpan {
  data
  byte_length
}
```

`byte_length` is authoritative. Embedded U+0000 is ordinary data and does not
terminate the value. A backend must not derive an Oreslang string extent with
`strlen`, `strnlen`, a zero-byte scan, or an equivalent sentinel search.

A backend may use another internal carrier (for example a JVM `String`) only
if conversion to a byte-oriented boundary validates Unicode and emits the exact
UTF-8 byte sequence and byte length.

The following are distinct operations and must not be conflated:

- UTF-8 byte length
- Unicode scalar-value count
- grapheme-cluster count
- storage units used by a backend-specific carrier

The v1 ABI standardizes only UTF-8 byte length. It does not make a source-level
`length` property mean code points or graphemes.

## Unicode validity

Oreslang strings contain Unicode scalar values, not arbitrary UTF-16 code
units. A UTF-16-hosted backend must reject unpaired high or low surrogates before
encoding an Oreslang string as UTF-8. A UTF-8-hosted backend must reject
overlong encodings, surrogate code points, truncated sequences, continuation
errors, and code points above U+10FFFF.

U+0000 is valid and remains one zero byte in UTF-8.

## C-string boundary

A C string is a separate FFI representation. It is not an alias for Oreslang
`string` and there is no implicit conversion.

The canonical boundary model is:

```text
CString {
  data
  byte_length
}
```

with these invariants:

- `data` owns or borrows at least `byte_length + 1` bytes as declared by the
  concrete FFI operation.
- bytes `[0, byte_length)` are well-formed UTF-8.
- no byte in `[0, byte_length)` is zero.
- `data[byte_length] == 0`.
- `byte_length` excludes the terminating NUL.
- the terminator is storage/ABI metadata, not part of the Oreslang value.

Converting `string -> CString` rejects any embedded U+0000. It must never
truncate at the first zero byte. The empty Oreslang string converts to a
one-byte C buffer containing only NUL with `byte_length == 0`.

The spelling `CString` is reserved for the explicit FFI/stdlib boundary. This
contract does not claim that every backend already exposes a source-level
constructor or general C FFI.

## Inbound native pointers

An arbitrary native `char*` is not an Oreslang string.

The preferred inbound forms are APIs that already provide `(pointer, length)`;
those bytes are decoded using the explicit length and may contain embedded NUL
when the foreign API defines them as a byte span.

For a legacy API that supplies only a NUL-terminated pointer, conversion must be
an explicit FFI operation with an independently supplied maximum bound. An
unbounded scan of foreign memory is forbidden. The bounded scan is an unsafe
foreign-memory concern and must not become the implementation of ordinary
Oreslang string length.

## Ownership

The ordinary string span and a C-string adapter have independent ownership.
Creating a `CString` must not mutate the source string or append a terminator
inside shared Oreslang storage. Owned adapters release their own storage exactly
once. Borrowed adapters must prove the backing storage and terminator remain
live for the entire foreign call.

Actor ownership rules continue to apply: conversion does not grant raw pointer
authority and a C pointer must not escape its declared FFI lifetime.

## Required behavior

The machine-readable vectors in
`contracts/v1/string-abi-v1.json` cover:

- empty, ASCII, multibyte Unicode and supplementary Unicode
- embedded NUL retained by ordinary strings
- embedded NUL rejected by C-string conversion
- byte length excluding a C terminator
- malformed UTF-8 rejection
- unpaired surrogate rejection
- explicit-length inbound decoding
- prohibition on unbounded foreign-pointer scans

Backends claiming v1 parity must additionally prove their real I/O, FFI and
serialization boundaries preserve the same bytes.