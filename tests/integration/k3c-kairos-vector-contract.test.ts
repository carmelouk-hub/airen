import test from "node:test";
import assert from "node:assert/strict";
import {
  kairosVectorLiteral,
  normalizeKairosEmbeddingModelSpec,
  normalizeKairosEmbeddingVector,
  normalizeKairosSemanticSearchRequest,
} from "../../packages/kairos/src/vector.ts";

test("K3-C embedding model registration is explicit and provider/model agnostic", () => {
  assert.deepEqual(
    normalizeKairosEmbeddingModelSpec({
      modelKey: " Test.Provider.Model ",
      providerKey: " Test.Provider ",
      dimensions: 1536,
      distanceMetric: "COSINE",
    }),
    {
      modelKey: "test.provider.model",
      providerKey: "test.provider",
      dimensions: 1536,
      distanceMetric: "COSINE",
    },
  );
  assert.throws(
    () => normalizeKairosEmbeddingModelSpec({ modelKey: "m", providerKey: "p", dimensions: 0, distanceMetric: "COSINE" }),
    /explicit integer between 1 and 16000/,
  );
  assert.throws(
    () => normalizeKairosEmbeddingModelSpec({ modelKey: "valid-model", providerKey: "p", dimensions: 3, distanceMetric: "DOT" as "COSINE" }),
    /distance metric/,
  );
});

test("K3-C semantic vectors require exact dimensions and finite values", () => {
  assert.deepEqual(normalizeKairosEmbeddingVector([1, -0, 0.25], 3), [1, 0, 0.25]);
  assert.throws(() => normalizeKairosEmbeddingVector([1, 0], 3), /dimension mismatch/);
  assert.throws(() => normalizeKairosEmbeddingVector([1, Number.NaN, 0], 3), /finite numbers/);
  assert.throws(() => normalizeKairosEmbeddingVector([1, Number.POSITIVE_INFINITY, 0], 3), /finite numbers/);
});

test("K3-C semantic request has no implicit model and remains bounded", () => {
  const model = normalizeKairosEmbeddingModelSpec({
    modelKey: "k3.synthetic.3d",
    providerKey: "synthetic-test",
    dimensions: 3,
    distanceMetric: "COSINE",
  });
  assert.deepEqual(
    normalizeKairosSemanticSearchRequest({ modelKey: "k3.synthetic.3d", embedding: [1, 0, 0] }, model),
    { modelKey: "k3.synthetic.3d", embedding: [1, 0, 0], limit: 20 },
  );
  assert.throws(
    () => normalizeKairosSemanticSearchRequest({ modelKey: "another.model", embedding: [1, 0, 0] }, model),
    /model mismatch/,
  );
  assert.throws(
    () => normalizeKairosSemanticSearchRequest({ modelKey: "k3.synthetic.3d", embedding: [1, 0, 0], limit: 51 }, model),
    /between 1 and 50/,
  );
});

test("K3-C vector literal is deterministic and rejects non-finite input", () => {
  assert.equal(kairosVectorLiteral([1, -0, 0.5]), "[1,0,0.5]");
  assert.throws(() => kairosVectorLiteral([]), /cannot be empty/);
  assert.throws(() => kairosVectorLiteral([1, Number.NaN]), /finite values/);
});
