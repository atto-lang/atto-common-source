// Shared static contract. These records are *not* proof that either backend
// executes a form. The JSON Schema and exact guest fixtures are authoritative.
namespace Oreslang.DispatchReturnV1;

enum DispatchForm {
  ValueMatch: "match",
  ProceduralMatch: "do match",
  ValueSwitch: "switch",
  ProceduralSwitch: "do switch",
}

enum ReturnDestination {
  ArmResult: "ARM_RESULT",
  FunctionReturn: "FUNCTION_RETURN",
}

enum SupportLevel {
  Candidate: "candidate",
  Unsupported: "unsupported",
}

model BackendSupport {
  llvm: SupportLevel;
  graal: SupportLevel;
}

model DispatchOracleCase {
  id: string;
  form: DispatchForm;
  source: string;
  expected_result: int64;
  return_destination: ReturnDestination;
  support: BackendSupport;
}

model DispatchOracle {
  version: "dispatch-return-v1";
  cases: DispatchOracleCase[];
}
