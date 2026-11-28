// Candidate source-free AttoLang compact heap model, not a production allocator.
// C++20: g++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic ref32_heap_v1.cpp -o ref32 && ./ref32
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

namespace atto_ref32 {
using u32 = std::uint32_t;
using Ref32 = std::uint32_t;
static_assert(sizeof(Ref32) == 4);
static_assert(sizeof(void*) == 4 || sizeof(void*) == 8);
constexpr u32 SLOT_BITS = 20;
constexpr u32 SLOT_MASK = (1u << SLOT_BITS) - 1u;
constexpr u32 MAX_GENERATION = (1u << (32 - SLOT_BITS)) - 1u;
struct Fault : std::runtime_error { using std::runtime_error::runtime_error; };
void require(bool condition, const char* message) { if (!condition) throw Fault(message); }
struct ActorId {
    u32 tenant, slot, incarnation;
    friend bool operator==(const ActorId&, const ActorId&) = default;
};
// Sidecars live in the trusted actor runtime, not in each guest object or Ref32.
struct Slot {
    u32 offset = 0;
    u32 padded = 0;
    u32 length = 0;
    std::uint16_t generation = 1;
    bool live = false;
    bool retired = false;
};
struct Span { u32 offset, length; };
static_assert(sizeof(Slot) == 16);
static_assert(sizeof(Span) == 8);

class Arena {
    ActorId owner_;
    std::vector<std::uint8_t> bytes_;
    std::vector<Slot> slots_;
    std::vector<Span> free_;
    bool closed_ = false;

    static u32 checked_capacity(u32 capacity) {
        require(capacity >= 16 && (capacity & 7u) == 0u, "invalid heap capacity");
        return capacity;
    }
    static u32 checked_slot_count(u32 count) {
        require(count > 0 && count <= SLOT_MASK, "invalid slot capacity");
        return count;
    }
    static u32 padded_size(u32 n) {
        require(n > 0 && n <= std::numeric_limits<u32>::max() - 7u, "size overflow");
        return (n + 7u) & ~7u;
    }
    Slot& checked_slot(Ref32 ref, ActorId caller) {
        require(!closed_ && caller == owner_, "foreign or closed actor context");
        const u32 encoded_slot = ref & SLOT_MASK;
        const u32 generation = ref >> SLOT_BITS;
        require(encoded_slot > 0 && encoded_slot <= slots_.size() && generation != 0,
                "invalid Ref32 encoding");
        Slot& slot = slots_[encoded_slot - 1];
        require(slot.live && !slot.retired && slot.generation == generation,
                "stale or forged Ref32");
        require(slot.offset >= 8 && slot.offset <= bytes_.size() &&
                slot.padded <= bytes_.size() - slot.offset && slot.length <= slot.padded,
                "invalid sidecar bounds");
        return slot;
    }
public:
    Arena(ActorId owner, u32 capacity, u32 max_slots)
        : owner_(owner), bytes_(checked_capacity(capacity), 0), slots_(checked_slot_count(max_slots)) {
        // Every free span requires a live or retired slot boundary; no hot-path growth.
        free_.reserve(static_cast<std::size_t>(max_slots) + 1u);
        free_.push_back({8, capacity - 8}); // zero is NULL; reserve first 8 bytes.
    }
    Ref32 allocate(u32 requested) {
        require(!closed_, "closed actor heap");
        const u32 padded = padded_size(requested);
        std::size_t slot_i = 0;
        while (slot_i < slots_.size() && (slots_[slot_i].live || slots_[slot_i].retired)) ++slot_i;
        require(slot_i < slots_.size(), "Ref32 slot quota");
        std::size_t span_i = 0;
        while (span_i < free_.size() && free_[span_i].length < padded) ++span_i;
        require(span_i < free_.size(), "heap byte quota");
        const u32 offset = free_[span_i].offset;
        if (free_[span_i].length == padded) free_.erase(free_.begin() + static_cast<std::ptrdiff_t>(span_i));
        else { free_[span_i].offset += padded; free_[span_i].length -= padded; }
        Slot& slot = slots_[slot_i];
        slot.offset = offset;
        slot.padded = padded;
        slot.length = requested;
        slot.live = true;
        return (static_cast<u32>(slot.generation) << SLOT_BITS) | (static_cast<u32>(slot_i) + 1u);
    }
    void free_ref(Ref32 ref, ActorId caller) {
        Slot& slot = checked_slot(ref, caller);
        const u32 offset = slot.offset, padded = slot.padded;
        std::fill(bytes_.begin() + offset, bytes_.begin() + offset + padded, 0);
        slot.live = false;
        if (slot.generation == MAX_GENERATION) slot.retired = true;
        else ++slot.generation;
        // At most max_slots + 1 holes; merge adjacent runs without allocating.
        const auto it = std::lower_bound(free_.begin(), free_.end(), offset,
                                         [](const Span& span, u32 key) { return span.offset < key; });
        const auto index = static_cast<std::size_t>(it - free_.begin());
        free_.insert(it, {offset, padded});
        std::size_t merged = index;
        if (index > 0 && free_[index - 1].offset + free_[index - 1].length == free_[index].offset) {
            free_[index - 1].length += free_[index].length;
            free_.erase(free_.begin() + static_cast<std::ptrdiff_t>(index));
            merged = index - 1;
        }
        if (merged + 1 < free_.size() &&
            free_[merged].offset + free_[merged].length == free_[merged + 1].offset) {
            free_[merged].length += free_[merged + 1].length;
            free_.erase(free_.begin() + static_cast<std::ptrdiff_t>(merged + 1));
        }
    }
    void write_byte(Ref32 ref, ActorId caller, u32 index, std::uint8_t value) {
        Slot& slot = checked_slot(ref, caller);
        require(index < slot.length, "write past payload");
        bytes_[slot.offset + index] = value;
    }
    std::uint8_t read_byte(Ref32 ref, ActorId caller, u32 index) {
        Slot& slot = checked_slot(ref, caller);
        require(index < slot.length, "read past payload");
        return bytes_[slot.offset + index];
    }
    void close() {
        if (closed_) return;
        std::fill(bytes_.begin(), bytes_.end(), 0);
        for (auto& slot : slots_) { slot.live = false; slot.retired = true; }
        free_.clear();
        closed_ = true;
    }
    bool zeroized() const {
        return std::all_of(bytes_.begin(), bytes_.end(), [](auto b) { return b == 0; });
    }
    std::size_t sidecar_bytes() const {
        return slots_.capacity() * sizeof(Slot) + free_.capacity() * sizeof(Span);
    }
};
void reject(auto&& f, const char* message) {
    bool caught = false;
    try { f(); } catch (const Fault&) { caught = true; }
    require(caught, message);
}
void test(const char* label, auto&& f) { f(); std::cout << "PASS " << label << '\n'; }
} // namespace atto_ref32

int main() {
    using namespace atto_ref32;
    const ActorId a{7, 11, 1}, b{7, 12, 1}, restart{7, 11, 2};
    test("4-byte Ref32 and preallocated metadata", [&] {
        require(sizeof(Ref32) == 4 && sizeof(Slot) == 16, "layout mismatch");
        Arena heap(a, 64, 4);
        require(heap.sidecar_bytes() == 4 * 16 + 5 * 8, "unexpected metadata footprint");
    });
    test("construction rejects invalid bounds before allocating", [&] {
        reject([&] { Arena invalid(a, 0, 1); }, "zero capacity accepted");
        reject([&] { Arena invalid(a, 17, 1); }, "unaligned capacity accepted");
        reject([&] { Arena invalid(a, 16, 0); }, "zero slots accepted");
        reject([&] { Arena invalid(a, 16, SLOT_MASK + 1u); }, "slot overflow accepted");
    });
    test("null, slot and generation encoding", [&] {
        Arena heap(a, 32, 2);
        reject([&] { (void)heap.read_byte(0, a, 0); }, "null dereference accepted");
        const Ref32 x = heap.allocate(5);
        require((x & SLOT_MASK) == 1 && (x >> SLOT_BITS) == 1, "incorrect Ref32 encoding");
        heap.write_byte(x, a, 4, 42);
        require(heap.read_byte(x, a, 4) == 42, "read-back failure");
        reject([&] { (void)heap.read_byte(x, a, 5); }, "out of bounds accepted");
    });
    test("same-size slot and space recycle rejects ABA", [&] {
        Arena heap(a, 24, 1);
        const Ref32 stale = heap.allocate(16);
        heap.write_byte(stale, a, 0, 99);
        heap.free_ref(stale, a);
        const Ref32 current = heap.allocate(16);
        require(current != stale && heap.read_byte(current, a, 0) == 0, "recycle failed");
        reject([&] { (void)heap.read_byte(stale, a, 0); }, "stale token revived");
        reject([&] { heap.free_ref(stale, a); }, "double free accepted");
    });
    test("fragmentation coalesces adjacent holes", [&] {
        Arena heap(a, 64, 4);
        const auto x = heap.allocate(8), y = heap.allocate(8), z = heap.allocate(8);
        heap.free_ref(y, a); heap.free_ref(x, a);
        const auto combined = heap.allocate(16);
        heap.write_byte(combined, a, 15, 23);
        require(heap.read_byte(combined, a, 15) == 23, "merged allocation corrupted");
        heap.free_ref(z, a); heap.free_ref(combined, a);
        (void)heap.allocate(56);
    });
    test("byte quota and slot quota fail atomically", [&] {
        Arena heap(a, 32, 1);
        reject([&] { (void)heap.allocate(32); }, "heap exceeded");
        reject([&] { (void)heap.allocate(0); }, "zero size accepted");
        const auto first = heap.allocate(8);
        reject([&] { (void)heap.allocate(8); }, "slot exceeded");
        heap.write_byte(first, a, 7, 11);
        require(heap.read_byte(first, a, 7) == 11, "failure damaged live allocation");
    });
    test("unsigned arithmetic overflow rejected before mutation", [&] {
        Arena heap(a, 32, 2);
        reject([&] { (void)heap.allocate(std::numeric_limits<u32>::max()); }, "u32 max accepted");
        reject([&] { (void)heap.allocate(std::numeric_limits<u32>::max() - 3); }, "wrap accepted");
        (void)heap.allocate(24);
    });
    test("caller provenance and incarnation checked", [&] {
        Arena heap(a, 32, 2);
        const auto token = heap.allocate(8);
        reject([&] { (void)heap.read_byte(token, b, 0); }, "foreign actor accepted");
        reject([&] { (void)heap.read_byte(token, restart, 0); }, "old incarnation accepted");
        reject([&] { heap.free_ref(token, b); }, "foreign free accepted");
    });
    test("forged and closed references fail closed", [&] {
        Arena heap(a, 32, 2);
        const auto x = heap.allocate(8);
        reject([&] { (void)heap.read_byte(x ^ (1u << SLOT_BITS), a, 0); }, "generation corruption accepted");
        reject([&] { (void)heap.read_byte(x + 2u, a, 0); }, "slot corruption accepted");
        heap.write_byte(x, a, 0, 91);
        heap.close(); heap.close();
        require(heap.zeroized(), "actor teardown not zeroized");
        reject([&] { (void)heap.read_byte(x, a, 0); }, "use after close accepted");
    });
    test("generation exhaustion retires the slot", [&] {
        Arena heap(a, 24, 1);
        Ref32 token = 0;
        for (u32 i = 1; i <= MAX_GENERATION; ++i) {
            token = heap.allocate(8);
            require((token >> SLOT_BITS) == i, "generation skipped or wrapped");
            heap.free_ref(token, a);
        }
        reject([&] { (void)heap.allocate(8); }, "retired slot reused");
        reject([&] { (void)heap.read_byte(token, a, 0); }, "retired handle revived");
    });
    test("independent heaps remain live after sibling close", [&] {
        Arena first(a, 32, 2), second(b, 32, 2);
        const auto x = first.allocate(8), y = second.allocate(8);
        first.write_byte(x, a, 0, 99); second.write_byte(y, b, 0, 42);
        first.close();
        require(first.zeroized() && second.read_byte(y, b, 0) == 42,
                "sibling heap changed after close");
    });
    std::cout << "11 Ref32 source-free model tests passed; NO production or cross-backend certification.\n";
}
