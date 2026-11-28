// Host-only semantic oracle for generator-driven property tests.
// Pure strategies with deterministic, bounded shrinking. No compiler or guest parity claims.
import { test_case } from './test_harness_v1.mjs';

function valid_integer(value, label) {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
}

function strategy_int(min, max) {
  valid_integer(min, 'min');
  valid_integer(max, 'max');
  if (max < min || max - min > 0xffffffff) throw new RangeError('invalid integer strategy bounds');
  return Object.freeze({
    kind: 'int',
    draw: ctx => ctx.random_int(min, max),
    shrink: value => {
      valid_integer(value, 'value');
      if (value < min || value > max) throw new RangeError('shrink value outside strategy');
      const candidates = new Set();
      const target = Math.max(min, Math.min(max, 0));
      if (target !== value) candidates.add(target);
      // Move toward the simplest allowed integer. The delta shrinks geometrically.
      let delta = value - target;
      while (Math.abs(delta) > 1) {
        delta = Math.trunc(delta / 2);
        const next = value - delta;
        if (next >= min && next <= max && next !== value) candidates.add(next);
      }
      if (value !== target) candidates.add(value + (value > target ? -1 : 1));
      return [...candidates];
    },
  });
}

function strategy_list(element, options = {}) {
  if (!element || typeof element.draw !== 'function' || typeof element.shrink !== 'function') {
    throw new TypeError('list requires element strategy');
  }
  const min_length = options.min_length ?? 0;
  const max_length = options.max_length ?? 16;
  valid_integer(min_length, 'min_length');
  valid_integer(max_length, 'max_length');
  if (min_length < 0 || max_length < min_length || max_length > 256) throw new RangeError('invalid list bounds');
  return Object.freeze({
    kind: 'list',
    draw: ctx => Array.from({ length: ctx.random_int(min_length, max_length) }, () => element.draw(ctx)),
    shrink: value => {
      if (!Array.isArray(value) || value.length < min_length || value.length > max_length) throw new TypeError('invalid list sample');
      const candidates = [];
      if (min_length === 0 && value.length !== 0) candidates.push([]);
      // Delete power-of-two sized contiguous chunks, preserving minimum length.
      for (let chunk = value.length; chunk >= 1; chunk = Math.floor(chunk / 2)) {
        if (value.length - chunk < min_length) { if (chunk === 1) break; continue; }
        for (let start = 0; start + chunk <= value.length; start += chunk) {
          candidates.push([...value.slice(0, start), ...value.slice(start + chunk)]);
        }
        if (chunk === 1) break;
      }
      for (let index = 0; index < value.length; index++) {
        const alternatives = element.shrink(value[index]);
        for (const replacement of alternatives) {
          const next = [...value]; next[index] = replacement; candidates.push(next);
        }
      }
      return candidates;
    },
  });
}

function property_case(name, generator, predicate, options = {}) {
  if (!generator || typeof generator.draw !== 'function' || typeof generator.shrink !== 'function') {
    throw new TypeError('property requires generator/shrinker');
  }
  if (typeof predicate !== 'function') throw new TypeError('property requires predicate');
  const runs = options.runs ?? 100;
  const max_shrinks = options.max_shrinks ?? 256;
  valid_integer(runs, 'runs'); valid_integer(max_shrinks, 'max_shrinks');
  if (runs < 1 || runs > 100000 || max_shrinks < 0 || max_shrinks > 4096) throw new RangeError('invalid property budgets');
  const body = async (ctx, ...resources) => {
    // A property replays its predicate while shrinking. A single mutable fixture
    // shared across these attempts would make the result order-dependent.
    if (resources.length) return { passed: false, message: 'property: fixture replay is unsupported; use a pure property or a per-attempt resource factory' };
    const property_context = Object.freeze({
      full_name: ctx.full_name, seed: ctx.seed,
      expect_equal: ctx.expect_equal, fail: ctx.fail,
    });
    async function evaluate(value) {
      try {
        // Clone so a user predicate cannot mutate the candidate held by the shrinker.
        const result = await predicate(property_context, structuredClone(value));
        if (result === undefined || result === true) return { failed: false };
        if (result === false) return { failed:true, reason:'predicate returned failure' };
        if (result && typeof result === 'object' && typeof result.passed === 'boolean') {
          return result.passed ? { failed:false } : {failed:true, reason:typeof result.message === 'string' && result.message ? result.message : 'predicate returned failure'};
        }
        return {failed:true,reason:'predicate returned unsupported outcome'};
      } catch (error) {
        return { failed: true, reason: String(error?.message ?? error) };
      }
    }
    for (let iteration = 0; iteration < runs; iteration++) {
      // Preserve the counterexample before an adversarial strategy can mutate it.
      const original = structuredClone(generator.draw(ctx));
      const result = await evaluate(original);
      if (!result.failed) continue;
      const rechecked = await evaluate(original);
      if (!rechecked.failed || rechecked.reason !== result.reason) {
        return { passed:false, message:`nonreproducible property failure: seed=${ctx.seed} iteration=${iteration} original=${JSON.stringify(original)} initial=${result.reason} repeat=${rechecked.reason ?? "passed"}` };
      }
      let minimal = structuredClone(original);
      let reason = result.reason;
      let attempts = 0;
      const visited = new Set([JSON.stringify(minimal)]);
      // Greedy deterministic shrinking: retry only a strict, previously unseen
      // candidate. A bounded attempt budget makes adversarial shrinkers terminate.
      while (attempts < max_shrinks) {
        let improved = false;
        // Pass a copy to the shrinker; it may not rewrite the saved witness.
        for (const candidate of generator.shrink(structuredClone(minimal))) {
          if (attempts >= max_shrinks) break;
          attempts++; // Count attempted candidates including duplicates to prevent unbounded streams.
          const fingerprint = JSON.stringify(candidate);
          if (visited.has(fingerprint)) continue;
          visited.add(fingerprint);
          const next = await evaluate(candidate);
          if (next.failed) {
            const repeat = await evaluate(candidate);
            if (!repeat.failed || repeat.reason !== next.reason) {
              return {passed:false,message:`nonreproducible shrinking: seed=${ctx.seed} iteration=${iteration} original=${JSON.stringify(original)} candidate=${JSON.stringify(candidate)}`};
            }
            // Assertion messages may include the candidate's actual value; differing
            // message text does not make this a different property failure.
            minimal = structuredClone(candidate); reason = next.reason; improved = true; break;
          }
        }
        if (!improved) break;
      }
      return { passed: false, message: `property failed: seed=${ctx.seed} iteration=${iteration} shrinks=${attempts} original=${JSON.stringify(original)} minimal=${JSON.stringify(minimal)} reason=${reason}` };
    }
    return { passed: true, message: '' };
  };
  return test_case(name, body, { requires_pure: true });
}

export { strategy_int, strategy_list, property_case };
