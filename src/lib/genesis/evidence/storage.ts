import * as fs from "node:fs";
import * as path from "node:path";
import {
  createHash,
  sign,
  verify,
  generateKeyPairSync,
  KeyObject,
  createPublicKey,
} from "node:crypto";
import { Evidence } from "../schemas/evidence.schema";
import { Manifest } from "../schemas/manifest.schema";

/**
 * Exporta una clave pública a PEM (SPKI). Los tipos de @types/node solo
 * exponen JWK en KeyObject.export(); el runtime soporta PEM (spki).
 */
function publicKeyToPem(key: KeyObject): string {
  const exportable = key as unknown as {
    export(opts: { format: "pem"; type: "spki" }): string | Buffer;
  };
  const exported = exportable.export({ format: "pem", type: "spki" });
  return Buffer.isBuffer(exported) ? exported.toString("utf8") : exported;
}

export interface EvidenceStorageConfig {
  baseDir?: string;
  signingKey?: KeyObject;
}

export class EvidenceStorage {
  private baseDir: string;
  private signingKey: KeyObject | null;

  constructor(config: EvidenceStorageConfig = {}) {
    this.baseDir = config.baseDir ?? path.join(process.cwd(), "genesis");
    this.signingKey = config.signingKey ?? null;
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.baseDir,
      path.join(this.baseDir, "evidence"),
      path.join(this.baseDir, "manifests"),
      path.join(this.baseDir, "reports"),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  async storeEvidence(evidence: Evidence): Promise<string> {
    const evidenceDir = path.join(this.baseDir, "evidence", evidence.id);
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    const filePath = path.join(evidenceDir, "evidence.json");
    const content = JSON.stringify(evidence, null, 2);
    fs.writeFileSync(filePath, content, "utf8");

    const hashFile = path.join(evidenceDir, "evidence.hash");
    const hash = createHash("sha3-512").update(content).digest("hex");
    fs.writeFileSync(hashFile, hash, "utf8");

    return evidence.id;
  }

  async loadEvidence(id: string): Promise<Evidence | null> {
    const filePath = path.join(this.baseDir, "evidence", id, "evidence.json");
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as Evidence;
  }

  async verifyEvidence(id: string): Promise<boolean> {
    const filePath = path.join(this.baseDir, "evidence", id, "evidence.json");
    const hashFile = path.join(this.baseDir, "evidence", id, "evidence.hash");

    if (!fs.existsSync(filePath) || !fs.existsSync(hashFile)) return false;

    const content = fs.readFileSync(filePath, "utf8");
    const storedHash = fs.readFileSync(hashFile, "utf8").trim();
    const computedHash = createHash("sha3-512").update(content).digest("hex");

    return storedHash === computedHash;
  }

  async listEvidences(): Promise<string[]> {
    const evidenceDir = path.join(this.baseDir, "evidence");
    if (!fs.existsSync(evidenceDir)) return [];

    return fs.readdirSync(evidenceDir).filter((name) => {
      const itemPath = path.join(evidenceDir, name);
      return (
        fs.statSync(itemPath).isDirectory() && fs.existsSync(path.join(itemPath, "evidence.json"))
      );
    });
  }

  async saveManifest(manifest: Manifest): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const manifestDir = path.join(this.baseDir, "manifests", timestamp);
    fs.mkdirSync(manifestDir, { recursive: true });

    const manifestPath = path.join(manifestDir, "manifest.json");
    const content = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(manifestPath, content, "utf8");

    const hashPath = path.join(manifestDir, "manifest.hash");
    const hash = createHash("sha3-512").update(content).digest("hex");
    fs.writeFileSync(hashPath, hash, "utf8");

    if (this.signingKey) {
      const signature = sign("sha3-512", Buffer.from(content), this.signingKey);
      const sigPath = path.join(manifestDir, "manifest.sig");
      fs.writeFileSync(sigPath, signature.toString("base64"), "utf8");

      const pubKeyPath = path.join(manifestDir, "public_key.pem");
      fs.writeFileSync(pubKeyPath, publicKeyToPem(this.signingKey), "utf8");
    }

    return manifestPath;
  }

  async loadLatestManifest(): Promise<Manifest | null> {
    const manifestsDir = path.join(this.baseDir, "manifests");
    if (!fs.existsSync(manifestsDir)) return null;

    const dirs = fs
      .readdirSync(manifestsDir)
      .filter((name) => fs.statSync(path.join(manifestsDir, name)).isDirectory())
      .sort()
      .reverse();

    if (dirs.length === 0) return null;

    const latestDir = path.join(manifestsDir, dirs[0]);
    const manifestPath = path.join(latestDir, "manifest.json");

    if (!fs.existsSync(manifestPath)) return null;

    const content = fs.readFileSync(manifestPath, "utf8");
    return JSON.parse(content) as Manifest;
  }

  generateSigningKeyPair(): { privateKey: KeyObject; publicKey: string } {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    this.signingKey = privateKey;
    return { privateKey, publicKey: publicKeyToPem(publicKey) };
  }

  verifyManifestSignature(manifestPath: string, publicKeyPem: string): boolean {
    try {
      const content = fs.readFileSync(manifestPath, "utf8");
      const sigPath = manifestPath.replace("manifest.json", "manifest.sig");
      if (!fs.existsSync(sigPath)) return false;

      const signature = Buffer.from(fs.readFileSync(sigPath, "utf8"), "base64");
      const publicKey = createPublicKey({ key: publicKeyPem, format: "pem" });

      return verify("sha3-512", Buffer.from(content), publicKey, signature);
    } catch {
      return false;
    }
  }
}

export class HashChain {
  private chain: string[] = [];
  private readonly hashAlgorithm = "sha3-512";

  add(data: string): string {
    const prevHash = this.chain[this.chain.length - 1] ?? "0".repeat(128);
    const combined = data + prevHash;
    const hash = createHash(this.hashAlgorithm).update(combined).digest("hex");
    this.chain.push(hash);
    return hash;
  }

  verify(data: string[], expectedFinalHash: string): boolean {
    let prevHash = "0".repeat(128);
    for (const item of data) {
      const combined = item + prevHash;
      const hash = createHash(this.hashAlgorithm).update(combined).digest("hex");
      prevHash = hash;
    }
    return prevHash === expectedFinalHash;
  }

  getChain(): string[] {
    return [...this.chain];
  }

  getCurrentHash(): string {
    return this.chain[this.chain.length - 1] ?? "0".repeat(128);
  }

  clear(): void {
    this.chain = [];
  }

  length(): number {
    return this.chain.length;
  }
}

export function createEvidenceStorage(config?: EvidenceStorageConfig): EvidenceStorage {
  return new EvidenceStorage(config);
}

export function createHashChain(): HashChain {
  return new HashChain();
}
