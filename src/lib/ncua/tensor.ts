/**
 * NCUA — tensor-lite: operaciones de matrices/vectores de formas fijas en
 * TypeScript puro para el puente de atención federada. Sin torch: las
 * mismas fórmulas con Float64Array, pesos inicializados con Xavier a partir
 * de una semilla fija (determinista entre ejecuciones). Los pesos con
 * semilla fija NO son un modelo entrenado: el rendimiento real debe
 * medirse con la caja de métricas, no asumirse.
 */

export {};

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gelu(x: number): number {
  return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)));
}

export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const expX = Math.exp(x);
  return expX / (1 + expX);
}

export function matmul(
  a: Float64Array,
  b: Float64Array,
  n: number,
  k: number,
  m: number,
): Float64Array {
  const out = new Float64Array(n * m);
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < m; col += 1) {
      let sum = 0;
      for (let inner = 0; inner < k; inner += 1) {
        sum += a[row * k + inner] * b[inner * m + col];
      }
      out[row * m + col] = sum;
    }
  }
  return out;
}

export function softmaxRow(vector: Float64Array): Float64Array {
  const out = new Float64Array(vector.length);
  let max = vector[0] ?? -Infinity;
  for (let index = 1; index < vector.length; index += 1) {
    if ((vector[index] as number) > max) max = vector[index] as number;
  }
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) {
    out[index] = Math.exp((vector[index] as number) - max);
    sum += out[index] as number;
  }
  if (sum > 0) {
    for (let index = 0; index < vector.length; index += 1) {
      out[index] = (out[index] as number) / sum;
    }
  }
  return out;
}

export interface LinearLayer {
  weights: Float64Array;
  bias: Float64Array;
  fanIn: number;
  fanOut: number;
}

export function xavierScale(fanIn: number, fanOut: number): number {
  return Math.sqrt(6 / (fanIn + fanOut));
}

export function createLinear(fanIn: number, fanOut: number, rng: () => number): LinearLayer {
  const scale = xavierScale(fanIn, fanOut);
  const weights = new Float64Array(fanIn * fanOut);
  for (let index = 0; index < weights.length; index += 1) {
    weights[index] = (rng() * 2 - 1) * scale;
  }
  return { weights, bias: new Float64Array(fanOut), fanIn, fanOut };
}

export function linearForward(input: Float64Array, layer: LinearLayer): Float64Array {
  const out = new Float64Array(layer.fanOut);
  for (let col = 0; col < layer.fanOut; col += 1) {
    let sum = layer.bias[col] as number;
    for (let row = 0; row < layer.fanIn; row += 1) {
      sum += (input[row] as number) * (layer.weights[row * layer.fanOut + col] as number);
    }
    out[col] = sum;
  }
  return out;
}

export function elementwiseAdd(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length);
  for (let index = 0; index < a.length; index += 1) {
    out[index] = (a[index] as number) + (b[index] as number);
  }
  return out;
}

export function elementwiseMult(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length);
  for (let index = 0; index < a.length; index += 1) {
    out[index] = (a[index] as number) * (b[index] as number);
  }
  return out;
}

export function scalarMultiply(a: Float64Array, scalar: number): Float64Array {
  const out = new Float64Array(a.length);
  for (let index = 0; index < a.length; index += 1) {
    out[index] = (a[index] as number) * scalar;
  }
  return out;
}

export function meanVectors(vectors: Float64Array[]): Float64Array {
  if (vectors.length === 0) return new Float64Array(0);
  const out = new Float64Array(vectors[0]?.length ?? 0);
  for (const vector of vectors) {
    for (let index = 0; index < out.length; index += 1) {
      out[index] += (vector[index] as number) / vectors.length;
    }
  }
  return out;
}

export function dotVector(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    sum += (a[index] as number) * (b[index] as number);
  }
  return sum;
}
