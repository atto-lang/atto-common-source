import assert from "node:assert/strict";
import test from "node:test";
import { elaborateProtocol } from "./protocols.mjs";
import { analyzeProtocolGraph } from "./protocol-graph-analysis.mjs";

test("graph analysis distinguishes unreachable, sinks, and cycles without terminal paths", () => {
  const protocol = elaborateProtocol({
    name: "Work", initial: "Start", terminals: ["Done"],
    edges: [
      { source: "Start", target: "Done", message: "finish" },
      { source: "Start", target: "Sink", message: "drop" },
      { source: "Start", target: "Loop", message: "retry" },
      { source: "Loop", target: "Loop", message: "again" },
      { source: "Hidden", target: "Done", message: "secret" },
    ],
  });
  assert.deepEqual(analyzeProtocolGraph(protocol), {
    unreachable: ["Hidden"], reachableNonterminalSinks: ["Sink"],
    reachableWithoutTerminalPath: ["Loop", "Sink"],
  });
});
test("possible terminal path is not eventual termination", () => {
  const protocol = elaborateProtocol({
    name: "Work", initial: "Start", terminals: ["Done"],
    edges: [
      { source: "Start", target: "Start", message: "again" },
      { source: "Start", target: "Done", message: "finish" },
    ],
  });
  assert.deepEqual(analyzeProtocolGraph(protocol), {
    unreachable: [], reachableNonterminalSinks: [], reachableWithoutTerminalPath: [],
  });
});
