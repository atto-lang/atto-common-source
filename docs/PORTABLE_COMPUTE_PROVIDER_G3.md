# Portable compute provider G3

G3 is the trusted physical-provider boundary beneath the G1 authority ABI and
G2 portable kernel IR. It does not enable source `gpu { }`, `gpu task { }`,
or `kernel` syntax.

The first physical backend is OpenCL 1.2. Provider code is trusted runtime code;
guest code cannot load a provider, construct a physical allocation, fabricate a
queue, or manufacture a completion event.

## Provider transaction

A launch follows this order:

1. authenticate tenant, device and queue capabilities;
2. reserve per-tenant/device quotas using checked signed-i64 arithmetic;
3. authenticate input/output physical allocations and exact G2 layout;
4. claim both host fences in the **reserved** state;
5. enqueue upload/kernel work;
6. only after the device API has durably accepted the command, mark the exact
   host fence pair **submitted**;
7. accept completion only from the exact provider-owned native event;
8. download output after successful device completion;
9. terminally update the host fence pair;
10. physically release buffers/events/queue resources and then return resident
    and event quota.

If enqueue fails before hardware acceptance, the provider must use the exact
pre-enqueue abort path and roll quota back. Once a command is submitted,
pre-enqueue abort is forbidden.

## Cancellation, timeout and device loss

Cancellation requests do not prove quiescence. Timeout also does not permit
reclamation. A cancelled or timed-out operation retains allocation/event quota
until the provider establishes physical quiescence or performs an authenticated
device reset/loss transition.

Device loss poisons outstanding allocation authority, but device loss by itself
is **not** proof of physical quiescence. The provider retains quota, physical
handles and submitted fence authority until an explicit provider recovery/reset
operation proves that the lost device/queue can no longer touch the allocations.
Only then may it acknowledge the poisoned fence pair and release physical
resources. A late event from a lost device generation cannot revive or complete
a new allocation generation.

## Quotas

The trusted provider independently accounts for resident device bytes, pinned
host bytes, outstanding device events, and queue slots per tenant/device.
Metadata fence byte counts are not quota authority. Quota must be reserved
before fence claim and released according to the physical resource lifetime,
not merely host-ledger state.

## Testing and evidence

The OpenCL C ABI is injectable so deterministic tests can force allocation,
upload, build, enqueue, event, download and release failures without requiring
GPU hardware. Those tests certify the provider state machine only.

A runtime-loaded OpenCL implementation may additionally execute a conditional
real-device probe when a usable platform/device is present. A fake ABI,
generated OpenCL text, successful compilation, or CPU reference execution is
**not** GPU execution evidence. Real GPU evidence requires the actual device
event for the submitted operation plus verified download/result and physical
release.

G3 still leaves source accelerator syntax fail-closed. Compiler typed effects,
ownership lowering, async Future/Task integration and actor-exclusive
continuation scheduling remain later gates.

## Recovery authority

A failure before durable enqueue normally aborts the exact reserved fence pair
and releases physical allocations. If that **cleanup itself fails**, the
provider must retain the unreleased physical handle(s) and their quota lease in
provider-owned recovery state. It may not drop the last recovery capability or
release quota merely because host fence rollback succeeded. New submissions
remain quarantined until cleanup retry succeeds or an authenticated provider
teardown/reset establishes physical release.

Prepared program release follows the same rule: a failed driver release must
leave the prepared-program authority retryable rather than marking it closed.

## Queue and artifact authentication

Java/Graal and native providers must both bind an opaque queue capability to the
exact device authority and nonzero queue generation. Textual queue/device IDs
are diagnostics only.

Before program preparation or enqueue, a physical provider validates every G2
artifact ABI requirement against the authenticated device: ABI version,
required address width, f32 support, canonical little-endian interpretation,
required bytes, and both global NDRange dimensions. Matching generated source
alone is never compatibility or execution evidence.
