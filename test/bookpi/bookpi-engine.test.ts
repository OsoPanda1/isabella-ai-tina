import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { BookPiEngine } from "../../src/lib/bookpi/BookPiEngine";
import { calculateBookPiRoyalties } from "../../src/lib/bookpi/royalties";
import { resetConfigCache } from "../../src/lib/config";

// Config de test determinista: firma RSA real (coincidente con el enum).
beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.BOOKPI_SIGNATURE_ALGORITHM = "RSA-SHA256";
  process.env.BOOKPI_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  delete process.env.NODE_ENV;
  process.env.ISABELLA_RUNTIME_MODE = "development";
  resetConfigCache();
});

describe("BookPiEngine (chunking + Merkle + ZK + firma)", () => {
  describe("chunkBuffer", () => {
    it("fragmenta un buffer pequeño en 1 chunk", () => {
      const buffer = Buffer.from("small test data");
      const { hashes, rawChunks } = BookPiEngine.chunkBuffer(buffer);
      expect(hashes.length).toBe(1);
      expect(rawChunks[0]).toEqual(buffer);
    });

    it("fragmenta 200KB en 4 chunks (64KiB c/u)", () => {
      const buffer = Buffer.alloc(200 * 1024, "a");
      const { hashes, rawChunks } = BookPiEngine.chunkBuffer(buffer);
      expect(hashes.length).toBe(4);
      expect(rawChunks.length).toBe(4);
    });

    it("es determinista (mismos hashes para el mismo buffer)", () => {
      const buffer = Buffer.from("test data for chunking");
      const a = BookPiEngine.chunkBuffer(buffer).hashes;
      const b = BookPiEngine.chunkBuffer(buffer).hashes;
      expect(a).toEqual(b);
    });

    it("maneja buffer vacío", () => {
      const { hashes, rawChunks } = BookPiEngine.chunkBuffer(Buffer.alloc(0));
      expect(hashes.length).toBe(0);
      expect(rawChunks.length).toBe(0);
    });
  });

  describe("buildMerkleTree", () => {
    it("una sola hoja → raíz definida", () => {
      const { root, tree } = BookPiEngine.buildMerkleTree(["a".repeat(64)]);
      expect(root).toBeDefined();
      expect(tree.length).toBe(1);
    });

    it("múltiples hojas → raíz determinista", () => {
      const leaves = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
      const r1 = BookPiEngine.buildMerkleTree(leaves).root;
      const r2 = BookPiEngine.buildMerkleTree(leaves).root;
      expect(r1).toBe(r2);
    });

    it("hojas vacías → lanza", () => {
      expect(() => BookPiEngine.buildMerkleTree([])).toThrow("hojas vacías");
    });
  });

  describe("generateMerkleProof / verifyChunkProof", () => {
    it("prueba válida para un chunk", () => {
      const leaves = Array(8).fill("a".repeat(64));
      const proof = BookPiEngine.generateMerkleProof(leaves, 3);
      expect(proof.chunkIndex).toBe(3);
      expect(BookPiEngine.verifyChunkProof(proof)).toBe(true);
    });

    it("rechaza prueba manipulada", () => {
      const leaves = Array(8).fill("a".repeat(64));
      const proof = BookPiEngine.generateMerkleProof(leaves, 3);
      proof.chunkHash = "tampered";
      expect(BookPiEngine.verifyChunkProof(proof)).toBe(false);
    });

    it("índice fuera de rango → lanza", () => {
      const leaves = Array(4).fill("a".repeat(64));
      expect(() => BookPiEngine.generateMerkleProof(leaves, 9)).toThrow("fuera de rango");
    });
  });

  describe("generateZKCommitment", () => {
    it("commitment de 64 hex + salt de 32 bytes", () => {
      const { commitment, salt } = BookPiEngine.generateZKCommitment("a".repeat(64), "author-1");
      expect(commitment).toHaveLength(64);
      expect(salt).toHaveLength(64);
    });

    it("mismo salt → mismo commitment; salt distinto → commitment distinto", () => {
      const c1 = BookPiEngine.generateZKCommitment("a".repeat(64), "a", "fixed-salt").commitment;
      const c2 = BookPiEngine.generateZKCommitment("a".repeat(64), "a", "fixed-salt").commitment;
      const c3 = BookPiEngine.generateZKCommitment("a".repeat(64), "a", "other-salt").commitment;
      expect(c1).toBe(c2);
      expect(c1).not.toBe(c3);
    });
  });

  describe("processManuscript (firma real)", () => {
    it("registro completo con firma no vacía y algoritmo configurado", () => {
      const result = BookPiEngine.processManuscript({
        authorId: "auth-1",
        title: "Manuscrito de Prueba",
        category: "MANUSCRIPT",
        fileBuffer: Buffer.alloc(150 * 1024, "x"),
        secretSalt: "test-salt",
      });
      expect(result.totalChunks).toBe(3);
      expect(result.merkleRoot).toHaveLength(64);
      expect(result.payloadHash).toHaveLength(64);
      expect(result.pqcSignature.length).toBeGreaterThan(0);
      expect(result.signatureAlgorithm).toBe("RSA-SHA256");
    });
  });
});

describe("calculateBookPiRoyalties (BigInt exacto)", () => {
  it("reparto en 7 federaciones sin pérdida", () => {
    const total = BigInt(10000);
    const shares = Array.from({ length: 7 }, (_, i) => ({
      federationId: i + 1,
      basisPoints: 1428,
      walletAddress: `wallet-${i + 1}`,
    }));
    const splits = calculateBookPiRoyalties(total, shares);
    expect(splits.length).toBe(7);
    const distributed = splits.reduce((s, x) => s + BigInt(x.payoutAmountWei), 0n);
    expect(distributed).toBe(total);
  });

  it("remanente exacto en la última federación", () => {
    const total = BigInt(10000);
    const splits = calculateBookPiRoyalties(total, [
      { federationId: 1, basisPoints: 3333, walletAddress: "w1" },
      { federationId: 2, basisPoints: 3333, walletAddress: "w2" },
      { federationId: 3, basisPoints: 3333, walletAddress: "w3" },
    ]);
    const distributed = splits.reduce((s, x) => s + BigInt(x.payoutAmountWei), 0n);
    expect(distributed).toBe(total);
  });

  it("revenue cero → todos cero", () => {
    const splits = calculateBookPiRoyalties(0n, [
      { federationId: 1, basisPoints: 5000, walletAddress: "w1" },
      { federationId: 2, basisPoints: 5000, walletAddress: "w2" },
    ]);
    splits.forEach((s) => expect(s.payoutAmountWei).toBe("0"));
  });
});
