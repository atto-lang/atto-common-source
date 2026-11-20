// Independently authored peer declaration. NOT yet emitter-verified against
// tensor-data-envelope.schema.json; wire acceptance MUST fail closed until
// TypeSpec JSON Schema 2020-12 witness parity and runtime probes are executed.
// Runtime also enforces contiguous [rows,cols], byteLength=rows*cols*8,
// trusted non-forgeable actor identity and frozen lease authority.
namespace Oreslang.Pipelines;

model TensorDescriptorV1 {
  dtype: "f64";
  shape: int64[];
  strides: int64[];
  byteLength: int64;
}

model FrozenTensorLeaseV1 {
  id: string;
  epoch: int64;
  mode: "frozen";
}

model TensorDataEnvelopeV1 {
  kind: "data";
  runId: string;
  graphEpoch: int64;
  actorEpoch: int64;
  partitionId: int64;
  sequence: int64;
  stepId: int64;
  microbatchId: int64;
  watermarkMs: int64;
  tensor: TensorDescriptorV1;
  lease: FrozenTensorLeaseV1;
  digest: string;
}

model TensorAckEnvelopeV1 {
  kind: "ack";
  runId: string;
  graphEpoch: int64;
  actorEpoch: int64;
  partitionId: int64;
  sequence: int64;
  digest: string;
}

model TensorWatermarkEnvelopeV1 {
  kind: "watermark";
  runId: string;
  graphEpoch: int64;
  actorEpoch: int64;
  partitionId: int64;
  watermarkMs: int64;
}

union TensorPipelineEnvelopeV1 {
  data: TensorDataEnvelopeV1,
  ack: TensorAckEnvelopeV1,
  watermark: TensorWatermarkEnvelopeV1
}
