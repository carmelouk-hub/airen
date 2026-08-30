export type KairosEmbeddingDistanceMetric = "COSINE" | "L2" | "INNER_PRODUCT";

export type KairosEmbeddingModelSpec = Readonly<{
  modelKey: string;
  providerKey: string;
  dimensions: number;
  distanceMetric: KairosEmbeddingDistanceMetric;
}>;

export type KairosSemanticSearchRequest = Readonly<{
  modelKey: string;
  embedding: readonly number[];
  limit?: number;
}>;

const MODEL_KEY = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const PROVIDER_KEY = /^[a-z0-9][a-z0-9._:-]{1,127}$/;

export function normalizeKairosEmbeddingModelSpec(input: KairosEmbeddingModelSpec): KairosEmbeddingModelSpec {
  const modelKey = input.modelKey.trim().toLowerCase();
  const providerKey = input.providerKey.trim().toLowerCase();
  if (!MODEL_KEY.test(modelKey)) throw new Error("Invalid Kairos embedding model key");
  if (!PROVIDER_KEY.test(providerKey)) throw new Error("Invalid Kairos embedding provider key");
  if (!Number.isInteger(input.dimensions) || input.dimensions < 1 || input.dimensions > 16000) {
    throw new Error("Kairos embedding dimensions must be an explicit integer between 1 and 16000");
  }
  if (!["COSINE", "L2", "INNER_PRODUCT"].includes(input.distanceMetric)) {
    throw new Error("Invalid Kairos embedding distance metric");
  }
  return Object.freeze({ modelKey, providerKey, dimensions: input.dimensions, distanceMetric: input.distanceMetric });
}

export function normalizeKairosEmbeddingVector(values: readonly number[], expectedDimensions: number): readonly number[] {
  if (!Number.isInteger(expectedDimensions) || expectedDimensions < 1 || expectedDimensions > 16000) {
    throw new Error("Invalid Kairos expected embedding dimensions");
  }
  if (values.length !== expectedDimensions) throw new Error("Kairos embedding dimension mismatch");
  const normalized = values.map((value) => {
    if (!Number.isFinite(value)) throw new Error("Kairos embedding values must be finite numbers");
    return Object.is(value, -0) ? 0 : value;
  });
  return Object.freeze(normalized);
}

export function normalizeKairosSemanticSearchRequest(
  input: KairosSemanticSearchRequest,
  model: KairosEmbeddingModelSpec,
): Readonly<{ modelKey: string; embedding: readonly number[]; limit: number }> {
  const normalizedModel = normalizeKairosEmbeddingModelSpec(model);
  const modelKey = input.modelKey.trim().toLowerCase();
  if (modelKey !== normalizedModel.modelKey) throw new Error("Kairos semantic search model mismatch");
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Kairos semantic search limit must be between 1 and 50");
  return Object.freeze({
    modelKey,
    embedding: normalizeKairosEmbeddingVector(input.embedding, normalizedModel.dimensions),
    limit,
  });
}

export function kairosVectorLiteral(values: readonly number[]): string {
  if (!values.length) throw new Error("Kairos vector literal cannot be empty");
  if (values.some((value) => !Number.isFinite(value))) throw new Error("Kairos vector literal requires finite values");
  return `[${values.map((value) => (Object.is(value, -0) ? 0 : value)).join(",")}]`;
}
