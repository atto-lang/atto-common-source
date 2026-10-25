// Compiler-emitted portable Symbol constants, never the guest-facing #name
// presentation. Return a kind ordinal, or null for a noncanonical/untrusted value.
// No accessor may be invoked during admission.
export function modelSymbolKindOrdinal(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("symbolKind") || !keys.includes("name")) return null;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
      return null;
  }
  const kind = value.symbolKind === "process" ? 0 :
      value.symbolKind === "stable" ? 1 : null;
  if (kind === null) return null;
  const name = value.name;
  if (typeof name !== "string" || name.length === 0 || name.length > 256)
    return null;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (++i >= name.length || name.charCodeAt(i) < 0xdc00 ||
          name.charCodeAt(i) > 0xdfff) return null;
    } else if (code >= 0xdc00 && code <= 0xdfff) return null;
  }
  if (name.normalize("NFC") !== name || Buffer.byteLength(name, "utf8") > 256 ||
      [...name].some(ch => {
        const cp = ch.codePointAt(0);
        return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || /\p{Cf}/u.test(ch);
      })) return null;
  if (kind === 1 &&
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(name))
    return null;
  return kind;
}
