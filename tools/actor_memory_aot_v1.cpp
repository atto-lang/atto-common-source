// Source-free executable reference model for the AttoLang actor memory contract.
// NOT a compiler, native guest runtime, or proof of backend parity.
// Build with C++20, strict warnings, then run the executable.
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace atto_contract {

using u32 = std::uint32_t;
struct Fault : std::runtime_error { using std::runtime_error::runtime_error; };
void demand(bool yes, const char* message) { if (!yes) throw Fault(message); }

struct ActorId {
    u32 tenant, slot, generation;
    friend bool operator==(const ActorId&, const ActorId&) = default;
};

enum class Region { Persistent, Scratch };
struct Allocation {
    ActorId owner;
    Region region;
    u32 offset, length, scratch_epoch, turn, allocation_id;
};

// Fixed-size, actor-private heap; no source-visible raw native pointer and no GC.
// The scratch partition is retired only at actor quiescence; per-turn capability
// validation prevents one concurrently active turn from reading another's scratch.
class Arena {
    ActorId owner_;
    std::vector<std::uint8_t> memory_;
    u32 persistent_limit_, persistent_top_ = 0, scratch_top_, scratch_epoch_ = 1;
    u32 loans_ = 0;
    u32 next_allocation_id_ = 1;
    std::map<u32, Allocation> live_allocations_;
    bool closed_ = false;
    static std::size_t checked_capacity(u32 persistent, u32 scratch) {
        demand(persistent <= std::numeric_limits<u32>::max() - scratch, "Ref32 capacity overflow");
        return static_cast<std::size_t>(persistent) + scratch;
    }
    static u32 align8(u32 value) {
        demand(value <= std::numeric_limits<u32>::max() - 7u, "alignment overflow");
        return (value + 7u) & ~7u;
    }
public:
    Arena(ActorId id, u32 persistent_bytes, u32 scratch_bytes)
        : owner_(id), memory_(checked_capacity(persistent_bytes, scratch_bytes), 0),
          persistent_limit_(persistent_bytes), scratch_top_(persistent_bytes) {
        demand(memory_.size() <= std::numeric_limits<u32>::max(), "arena larger than Ref32");
        demand((persistent_bytes & 7u) == 0u, "persistent boundary unaligned");
    }
    Allocation allocate(Region region, u32 bytes, u32 turn = 0) {
        demand(!closed_, "actor closed");
        demand(bytes > 0, "empty allocation");
        const u32 padded = align8(bytes);
        u32& top = (region == Region::Persistent) ? persistent_top_ : scratch_top_;
        const u32 limit = region == Region::Persistent ? persistent_limit_ : static_cast<u32>(memory_.size());
        demand(top <= limit && padded <= limit - top, "heap quota");
        const u32 old = top;
        demand(next_allocation_id_ != std::numeric_limits<u32>::max(), "allocation ID exhausted");
        const u32 id = next_allocation_id_++;
        Allocation h{owner_, region, old, bytes, scratch_epoch_, turn, id};
        live_allocations_.emplace(id, h);
        top += padded;
        return h;
    }
    void check(const Allocation& h, const ActorId& caller, u32 current_turn,
               const std::set<u32>& active_turns) const {
        demand(!closed_ && caller == owner_ && h.owner == owner_, "foreign/stale actor heap");
        const auto it = live_allocations_.find(h.allocation_id);
        demand(it != live_allocations_.end(), "unknown Ref32 allocation");
        const Allocation& original = it->second;
        demand(original.owner == h.owner && original.region == h.region &&
               original.offset == h.offset && original.length == h.length &&
               original.scratch_epoch == h.scratch_epoch && original.turn == h.turn,
               "forged Ref32 provenance");
        const u32 end = h.region == Region::Persistent ? persistent_top_ : scratch_top_;
        demand(h.offset <= end && h.length <= end - h.offset, "invalid Ref32 bounds");
        if (h.region == Region::Scratch) {
            demand(h.scratch_epoch == scratch_epoch_, "scratch epoch expired");
            demand(h.turn == current_turn && active_turns.contains(current_turn), "scratch escaped turn");
        }
    }
    void write(const Allocation& h, const ActorId& caller, u32 turn,
               const std::set<u32>& active, u32 index, std::uint8_t value) {
        check(h, caller, turn, active);
        demand(index < h.length, "index out of bounds");
        memory_[h.offset + index] = value;
    }
    std::uint8_t read(const Allocation& h, const ActorId& caller, u32 turn,
                      const std::set<u32>& active, u32 index) const {
        check(h, caller, turn, active);
        demand(index < h.length, "index out of bounds");
        return memory_[h.offset + index];
    }
    void borrow() { demand(!closed_, "closed borrow"); ++loans_; }
    void release() { demand(loans_ > 0, "loan double release"); --loans_; }
    u32 loans() const { return loans_; }
    void retire_scratch() {
        demand(loans_ == 0 && !closed_, "outstanding scratch loan");
        std::fill(memory_.begin() + persistent_limit_, memory_.begin() + scratch_top_, 0);
        scratch_top_ = persistent_limit_;
        for (auto it = live_allocations_.begin(); it != live_allocations_.end();) {
            if (it->second.region == Region::Scratch) it = live_allocations_.erase(it);
            else ++it;
        }
        demand(scratch_epoch_ != std::numeric_limits<u32>::max(), "scratch epoch exhausted");
        ++scratch_epoch_;
    }
    void close() {
        demand(loans_ == 0, "outstanding heap loan");
        std::fill(memory_.begin(), memory_.end(), 0);
        persistent_top_ = 0;
        scratch_top_ = persistent_limit_;
        live_allocations_.clear();
        closed_ = true;
    }
    bool zeroized() const { return std::all_of(memory_.begin(), memory_.end(), [](auto b) { return b == 0; }); }
};

struct FrameHandle { ActorId owner; u32 slot, generation, turn; };
class LogicalStack {
    struct Frame { u32 generation = 0, turn = 0, bytes = 0; bool live = false; };
    ActorId owner_;
    std::vector<Frame> frames_;
    std::vector<std::pair<u32, std::vector<u32>>> stacks_; // one LIFO chain per turn
    u32 max_bytes_, active_bytes_ = 0;
public:
    LogicalStack(ActorId owner, u32 max_frames, u32 max_bytes)
        : owner_(owner), frames_(max_frames), max_bytes_(max_bytes) {}
    FrameHandle push(u32 turn, u32 bytes) {
        demand(bytes > 0 && bytes <= max_bytes_ - active_bytes_, "logical stack byte quota");
        u32 slot = 0;
        while (slot < frames_.size() && frames_[slot].live) ++slot;
        demand(slot < frames_.size(), "logical stack frame quota");
        auto& f = frames_[slot];
        demand(f.generation != std::numeric_limits<u32>::max(), "frame generation exhausted");
        ++f.generation;
        f.live = true; f.turn = turn; f.bytes = bytes;
        active_bytes_ += bytes;
        auto it = std::find_if(stacks_.begin(), stacks_.end(), [=](const auto& p) { return p.first == turn; });
        if (it == stacks_.end()) { stacks_.push_back({turn, {slot}}); }
        else { it->second.push_back(slot); }
        return {owner_, slot, f.generation, turn};
    }
    void pop(FrameHandle h) {
        demand(h.owner == owner_ && h.slot < frames_.size(), "foreign frame");
        auto& f = frames_[h.slot];
        demand(f.live && f.turn == h.turn && f.generation == h.generation, "stale frame");
        auto it = std::find_if(stacks_.begin(), stacks_.end(), [=](const auto& p) { return p.first == h.turn; });
        demand(it != stacks_.end() && !it->second.empty() && it->second.back() == h.slot, "non-LIFO pop");
        it->second.pop_back();
        if (it->second.empty()) stacks_.erase(it);
        active_bytes_ -= f.bytes;
        f.bytes = 0; f.live = false; // generation stays for stale-frame detection
    }
    bool empty_turn(u32 turn) const {
        return std::none_of(stacks_.begin(), stacks_.end(), [=](const auto& p) { return p.first == turn; });
    }
    bool empty() const { return active_bytes_ == 0 && stacks_.empty(); }
    u32 active_bytes() const { return active_bytes_; }
};

// An actor owns one heap and one aggregate logical-stack budget. Concurrent
// receivers have independent LIFO chains. Carrier OS/Wasm stacks are NOT the
// actor's logical stacks. Serial actors admit one turn only.
class Actor {
    ActorId id_;
    bool serial_, closing_ = false, closed_ = false;
    std::set<u32> turns_;
    std::map<u32, u32> read_leases_;
    std::map<u32, u32> heap_loans_;
    std::optional<u32> writer_turn_;
    Arena heap_;
    LogicalStack frames_;
public:
    Actor(ActorId id, bool serial, u32 persistent = 64, u32 scratch = 64,
          u32 frame_count = 4, u32 frame_bytes = 128)
        : id_(id), serial_(serial), heap_(id, persistent, scratch),
          frames_(id, frame_count, frame_bytes) {}
    ActorId id() const { return id_; }
    const std::set<u32>& active_turns() const { return turns_; }
    void begin_turn(u32 turn) {
        demand(!closing_ && !closed_ && !turns_.contains(turn), "invalid turn admission");
        demand(!serial_ || turns_.empty(), "serial actor concurrently entered");
        turns_.insert(turn);
    }
    void end_turn(u32 turn) {
        demand(turns_.contains(turn), "unknown turn");
        demand(frames_.empty_turn(turn) && !read_leases_.contains(turn) &&
               !heap_loans_.contains(turn) && writer_turn_ != turn,
               "unbalanced turn cleanup");
        turns_.erase(turn);
        if (turns_.empty()) heap_.retire_scratch();
    }
    Allocation alloc(Region region, u32 size, u32 turn = 0) {
        demand(region == Region::Persistent || turns_.contains(turn), "no scratch turn");
        return heap_.allocate(region, size, turn);
    }
    void write(Allocation h, u32 turn, u32 index, std::uint8_t value) {
        heap_.write(h, id_, turn, turns_, index, value);
    }
    std::uint8_t read(Allocation h, u32 turn, u32 index) const {
        return heap_.read(h, id_, turn, turns_, index);
    }
    std::uint8_t read_as(Allocation h, ActorId caller, u32 turn, u32 index) const {
        return heap_.read(h, caller, turn, turns_, index);
    }
    FrameHandle push(u32 turn, u32 bytes) {
        demand(turns_.contains(turn), "frame outside turn");
        return frames_.push(turn, bytes);
    }
    void pop(FrameHandle frame) { frames_.pop(frame); }
    u32 frame_bytes() const { return frames_.active_bytes(); }
    void critical_read(u32 turn) {
        demand(turns_.contains(turn) && !writer_turn_ && !closed_, "writer holds state");
        ++read_leases_[turn];
    }
    void end_read(u32 turn) {
        auto it = read_leases_.find(turn);
        demand(it != read_leases_.end() && it->second > 0, "unbalanced read");
        if (--it->second == 0) read_leases_.erase(it);
    }
    void critical_write(u32 turn) {
        demand(turns_.contains(turn) && !writer_turn_ && read_leases_.empty() && !closed_, "state not exclusive");
        writer_turn_ = turn;
    }
    void end_write(u32 turn) {
        demand(writer_turn_ == turn, "unbalanced write");
        writer_turn_.reset();
    }
    void suspend(u32 turn) const {
        demand(turns_.contains(turn) && !read_leases_.contains(turn) &&
               writer_turn_ != turn && !heap_loans_.contains(turn), "borrow/lock across unsafe await");
    }
    void borrow(u32 turn) {
        demand(turns_.contains(turn), "borrow outside turn");
        heap_.borrow(); ++heap_loans_[turn];
    }
    void release(u32 turn) {
        auto it = heap_loans_.find(turn);
        demand(it != heap_loans_.end() && it->second > 0, "loan double release");
        heap_.release();
        if (--it->second == 0) heap_loans_.erase(it);
    }
    void request_stop() { closing_ = true; }
    void finish_stop() {
        demand(closing_ && turns_.empty() && frames_.empty() &&
               !writer_turn_ && read_leases_.empty() && heap_loans_.empty(),
               "actor not quiescent");
        heap_.close();
        closed_ = true;
    }
    bool zeroized() const { return heap_.zeroized(); }
};

// A bounded mailbox commits an owned payload move only after admission.
// Cross-tenant transfer is deliberately rejected here: it requires an explicit
// serialization/copy broker, never direct transport of arena-relative handles.
struct OwnedMessage { ActorId owner; std::vector<std::uint8_t> bytes; bool consumed = false; };
class Mailbox {
    ActorId receiver_;
    std::size_t capacity_;
    std::vector<OwnedMessage> queued_;
public:
    Mailbox(ActorId receiver, std::size_t capacity) : receiver_(receiver), capacity_(capacity) {
        // Preallocate admission slots: after quota checks a noexcept vector move
        // can no longer lose ownership to an allocation failure.
        queued_.reserve(capacity);
    }
    bool admit(OwnedMessage& source, ActorId sender) {
        demand(!source.consumed && source.owner == sender, "sender lacks owned payload");
        demand(sender.tenant == receiver_.tenant, "cross-tenant payload requires broker copy");
        if (queued_.size() >= capacity_) return false;
        queued_.push_back({receiver_, std::move(source.bytes), false});
        source.consumed = true;
        return true;
    }
    OwnedMessage receive() {
        demand(!queued_.empty(), "empty mailbox");
        OwnedMessage item = std::move(queued_.front());
        queued_.erase(queued_.begin());
        return item;
    }
};

void expect_reject(auto&& action, const char* why) {
    bool rejected = false;
    try { action(); } catch (const Fault&) { rejected = true; }
    demand(rejected, why);
}
void test(const char* name, auto&& fn) { fn(); std::cout << "PASS " << name << '\n'; }

} // namespace atto_contract

int main() {
    using namespace atto_contract;
    const ActorId a{7, 11, 1}, b{7, 12, 1}, a2{7, 11, 2};
    test("actor heap owner and Ref32 bounds", [&] {
        Actor first(a, false), second(b, false);
        auto h = first.alloc(Region::Persistent, 8);
        first.write(h, 0, 0, 42);
        demand(first.read(h, 0, 0) == 42, "persistent read failed");
        expect_reject([&] { (void)first.read_as(h, b, 0, 0); }, "foreign actor accepted");
        expect_reject([&] { (void)second.read_as(h, a, 0, 0); }, "foreign heap accepted");
        expect_reject([&] { (void)first.read(h, 0, 8); }, "out-of-bounds read accepted");
    });
    test("Ref32 provenance cannot be forged inside another allocation", [&] {
        Actor actor(a, false);
        auto first = actor.alloc(Region::Persistent, 8);
        (void)actor.alloc(Region::Persistent, 8);
        auto forged_offset = first; forged_offset.offset += 8;
        expect_reject([&] { (void)actor.read(forged_offset, 0, 0); }, "forged offset accepted");
        auto forged_length = first; forged_length.length += 1;
        expect_reject([&] { (void)actor.read(forged_length, 0, 0); }, "forged size accepted");
        auto forged_id = first; forged_id.allocation_id += 800;
        expect_reject([&] { (void)actor.read(forged_id, 0, 0); }, "forged allocation accepted");
    });
    test("persistent survives while scratch expires between turns", [&] {
        Actor actor(a, false);
        auto p = actor.alloc(Region::Persistent, 8);
        actor.write(p, 0, 0, 12);
        actor.begin_turn(1);
        auto s = actor.alloc(Region::Scratch, 8, 1);
        actor.write(s, 1, 0, 23);
        actor.end_turn(1);
        actor.begin_turn(2);
        demand(actor.read(p, 2, 0) == 12, "persistent state lost");
        expect_reject([&] { (void)actor.read(s, 2, 0); }, "scratch escape accepted");
        actor.end_turn(2);
    });
    test("concurrent turns separate scratch and logical stacks", [&] {
        Actor actor(a, false);
        actor.begin_turn(1); actor.begin_turn(2);
        auto s1 = actor.alloc(Region::Scratch, 8, 1);
        auto s2 = actor.alloc(Region::Scratch, 8, 2);
        actor.write(s1, 1, 0, 11); actor.write(s2, 2, 0, 22);
        demand(actor.read(s1, 1, 0) == 11 && actor.read(s2, 2, 0) == 22, "turn scratch corrupted");
        expect_reject([&] { (void)actor.read(s1, 2, 0); }, "cross-turn scratch accepted");
        auto f1 = actor.push(1, 16), f2 = actor.push(2, 32);
        actor.pop(f1); actor.end_turn(1);
        demand(actor.read(s2, 2, 0) == 22, "scratch reset while concurrent turn active");
        actor.pop(f2); actor.end_turn(2);
        demand(actor.frame_bytes() == 0, "frame bytes leaked");
    });
    test("serial actor rejects concurrent turns", [&] {
        Actor actor(a, true);
        actor.begin_turn(1);
        expect_reject([&] { actor.begin_turn(2); }, "serial actor overlapped");
        actor.end_turn(1);
        actor.begin_turn(2); actor.end_turn(2);
    });
    test("bounded stack quota is per actor, sibling survives", [&] {
        Actor first(a, false, 64, 64, 2, 24), second(b, false, 64, 64, 2, 24);
        first.begin_turn(1); second.begin_turn(1);
        auto f = first.push(1, 16);
        expect_reject([&] { (void)first.push(1, 16); }, "actor exceeded frame byte budget");
        auto sibling = second.push(1, 24);
        second.pop(sibling); second.end_turn(1);
        first.pop(f); first.end_turn(1);
    });
    test("LIFO and generation fence stale frame", [&] {
        Actor actor(a, false);
        actor.begin_turn(1);
        auto parent = actor.push(1, 8), child = actor.push(1, 8);
        expect_reject([&] { actor.pop(parent); }, "non-LIFO frame drop accepted");
        actor.pop(child); actor.pop(parent);
        auto recycled = actor.push(1, 8);
        expect_reject([&] { actor.pop(parent); }, "stale frame accepted after recycle");
        actor.pop(recycled); actor.end_turn(1);
    });
    test("active frame blocks turn teardown", [&] {
        Actor actor(a, false);
        actor.begin_turn(1);
        auto f = actor.push(1, 8);
        expect_reject([&] { actor.end_turn(1); }, "turn closed with live frame");
        actor.pop(f); actor.end_turn(1);
    });
    test("fair loan retirement requires explicit release", [&] {
        Actor actor(a, false);
        actor.begin_turn(1);
        actor.borrow(1);
        expect_reject([&] { actor.end_turn(1); }, "turn ended with live loan");
        actor.release(1); actor.end_turn(1);
        expect_reject([&] { actor.release(1); }, "loan double release accepted");
    });
    test("critical readers coexist; exclusive writer excludes readers", [&] {
        Actor actor(a, false);
        actor.begin_turn(1); actor.begin_turn(2);
        actor.critical_read(1); actor.critical_read(2);
        expect_reject([&] { actor.critical_write(1); }, "writer entered during reads");
        actor.end_read(1); actor.end_read(2);
        actor.critical_write(1);
        expect_reject([&] { actor.critical_read(2); }, "reader entered during write");
        actor.end_write(1); actor.end_turn(1); actor.end_turn(2);
    });
    test("suspension fails closed under write/read/heap loan", [&] {
        Actor actor(a, false);
        actor.begin_turn(1); actor.begin_turn(2);
        actor.critical_read(1);
        expect_reject([&] { actor.suspend(1); }, "suspend with read lease");
        actor.suspend(2); // a separate turn may suspend without holding a loan
        actor.end_turn(2); // another turn's read does not block its completion
        actor.end_read(1);
        actor.critical_write(1);
        expect_reject([&] { actor.suspend(1); }, "suspend with write lease");
        actor.end_write(1);
        actor.borrow(1);
        expect_reject([&] { actor.suspend(1); }, "suspend with heap loan");
        actor.release(1);
        actor.suspend(1);
        actor.end_turn(1);
    });
    test("quiescence and deterministic zeroization before close", [&] {
        Actor actor(a, false);
        auto h = actor.alloc(Region::Persistent, 8);
        actor.write(h, 0, 0, 99);
        actor.begin_turn(1); actor.request_stop();
        expect_reject([&] { actor.begin_turn(2); }, "admitted new turn after STOP");
        expect_reject([&] { actor.finish_stop(); }, "stopped while turn active");
        actor.end_turn(1); actor.finish_stop();
        demand(actor.zeroized(), "actor heap not zeroized");
        expect_reject([&] { (void)actor.read(h, 0, 0); }, "closed heap accessible");
    });
    test("restart changes owner incarnation", [&] {
        Actor first(a, false); auto h = first.alloc(Region::Persistent, 8);
        first.request_stop(); first.finish_stop();
        Actor restarted(a2, false);
        expect_reject([&] { (void)restarted.read_as(h, a2, 0, 0); }, "old incarnation accepted");
    });
    test("mailbox admission is atomic relative to ownership transfer", [&] {
        Mailbox queue(b, 1);
        OwnedMessage first{a, {3, 4, 5}, false};
        const auto* original = first.bytes.data();
        demand(queue.admit(first, a), "first send was not admitted");
        demand(first.consumed, "sender still owns accepted payload");
        auto item = queue.receive();
        demand(item.owner == b && item.bytes.data() == original && item.bytes[1] == 4,
               "same-tenant move copied or corrupted payload");
        OwnedMessage second{a, {7}, false}, third{a, {8}, false};
        demand(queue.admit(second, a), "second admission failed");
        demand(!queue.admit(third, a) && !third.consumed && third.bytes[0] == 8,
               "failed admission stole sender payload");
        expect_reject([&] { (void)queue.admit(third, ActorId{8, 11, 1}); },
                      "foreign tenant send accepted");
        (void)queue.receive();
        demand(queue.admit(third, a) && third.consumed, "retry did not transfer ownership");
    });
    test("overflow and heap quota fail closed", [&] {
        Actor actor(a, false, 16, 16);
        expect_reject([&] { (void)actor.alloc(Region::Persistent, std::numeric_limits<u32>::max()); }, "u32 overflow accepted");
        (void)actor.alloc(Region::Persistent, 16);
        expect_reject([&] { (void)actor.alloc(Region::Persistent, 1); }, "heap quota exceeded");
        actor.begin_turn(1);
        (void)actor.alloc(Region::Scratch, 16, 1);
        expect_reject([&] { (void)actor.alloc(Region::Scratch, 1, 1); }, "scratch quota exceeded");
        actor.end_turn(1);
    });
    std::cout << "15 source-free model tests passed; NO guest/AOT/parity certification.\n";
}