// Ordinals are part of the wire digest. Append layouts to preserve existing graphs.
const layouts = Object.freeze(["scalar", "contiguous", "aos", "soa"]);

export function modelBufferLayoutOrdinal(layout, rank) {
  const name = layout === undefined ? (rank === 0 ? "scalar" : "contiguous") : layout;
  switch (name) {
    case "scalar": return rank === 0 ? layouts.indexOf(name) : -1;
    case "contiguous": return rank > 0 ? layouts.indexOf(name) : -1;
    case "aos":
    case "soa": return rank === 2 ? layouts.indexOf(name) : -1;
    default: return -1;
  }
}
