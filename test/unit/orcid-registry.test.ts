import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const registryPath = join(process.cwd(), "docs", "research", "orcid-registry.json");
const raw = readFileSync(registryPath, "utf8");
const registry = JSON.parse(raw) as {
  schema: string;
  generated_at: string;
  source: { api: string; registry_page: string; content: string; verification: string };
  identity: {
    orcid: string;
    credit_name: string;
    other_names: string[];
    keywords: string[];
    external_identifiers: Array<{ type: string; value: string; url: string | null }>;
  };
  employment: Array<{ organization: string; role: string }>;
  works: Array<{ title: string | null; year: string | null; dois: string[]; put_codes: number[] }>;
  summary: { groups: number; works: number; works_with_doi: number; distinct_dois: number };
  distinct_dois: string[];
};

const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
const DOI_RE = /^10\.\d{4,9}\/\S+$/;

describe("registro ORCID (docs/research/orcid-registry.json)", () => {
  it("declara esquema, fecha y procedencia metadata-only", () => {
    expect(registry.schema).toBe("isabella-orcid-registry/v1");
    expect(registry.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(registry.source.api).toContain("pub.orcid.org/v3.0/0009-0008-5050-1539");
    expect(registry.source.verification).toContain("metadata-only");
  });

  it("identidad con ORCID bien formado y Loop declarado", () => {
    expect(registry.identity.orcid).toMatch(ORCID_RE);
    expect(registry.identity.orcid).toBe("0009-0008-5050-1539");
    expect(registry.identity.credit_name.length).toBeGreaterThan(0);
    expect(
      registry.identity.external_identifiers.find(
        (identifier) => identifier.type === "Loop profile",
      )?.value,
    ).toBe("3117809");
  });

  it("todo DOI cumple el prefijo 10.x y está en minúsculas", () => {
    for (const doi of registry.distinct_dois) {
      expect(doi).toMatch(DOI_RE);
      expect(doi).toBe(doi.toLowerCase());
    }
    for (const work of registry.works) {
      for (const doi of work.dois) expect(doi).toMatch(DOI_RE);
    }
  });

  it("la lista distinct_dois es la unión exacta, ordenada y sin duplicados", () => {
    const union = [...new Set(registry.works.flatMap((work) => work.dois))].sort();
    expect(registry.distinct_dois).toEqual(union);
    expect(new Set(registry.distinct_dois).size).toBe(registry.distinct_dois.length);
  });

  it("el resumen coincide con los datos (conteos verificables)", () => {
    expect(registry.summary.groups).toBe(registry.works.length);
    expect(registry.summary.works).toBe(
      registry.works.reduce((total, work) => total + work.put_codes.length, 0),
    );
    expect(registry.summary.works_with_doi).toBe(
      registry.works.filter((work) => work.dois.length > 0).length,
    );
    expect(registry.summary.distinct_dois).toBe(registry.distinct_dois.length);
    expect(registry.summary.works_with_doi).toBeGreaterThan(0);
  });

  it("no incluye correos ni estructuras de contacto", () => {
    expect(raw).not.toContain('"emails"');
    expect(raw.toLowerCase()).not.toMatch(/"email"\s*:/);
    expect(registry.works.length).toBeGreaterThan(0);
  });
});
