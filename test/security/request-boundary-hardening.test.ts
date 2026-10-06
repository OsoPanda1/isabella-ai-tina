import { describe, expect, it } from "vitest";
import { assertBoundedJsonValue, RequestLimitError } from "@/lib/request-limits";
import { parseSkillInput, skillInputSchemas } from "@/lib/skills/input-schemas";
import { listIsabellaSkills, type IsabellaSkillId } from "@/lib/skills/registry";

describe("request boundary hardening", () => {
  it("rejects prototype-pollution keys", () => {
    expect(() => assertBoundedJsonValue({ constructor: { polluted: true } })).toThrow(
      RequestLimitError,
    );
  });

  it("rejects deeply nested JSON", () => {
    let value: unknown = "leaf";
    for (let index = 0; index < 10; index += 1) value = { value };
    expect(() => assertBoundedJsonValue(value)).toThrow(/REQUEST_OBJECT_TOO_DEEP/);
  });

  it("rejects oversized object key sets", () => {
    const value = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [`k${index}`, true]),
    );
    expect(() => assertBoundedJsonValue(value)).toThrow(/REQUEST_OBJECT_TOO_LARGE/);
  });

  it("has an explicit bounded schema for every registered Isabella skill", () => {
    const registeredIds = listIsabellaSkills().map((skill) => skill.id);
    const schemaIds = Object.keys(skillInputSchemas);
    expect(schemaIds.length).toBeGreaterThanOrEqual(registeredIds.length);
    for (const skillId of registeredIds) {
      expect(schemaIds).toContain(skillId);
      const result = parseSkillInput(skillId as IsabellaSkillId, {});
      expect(result.success).toBe(true);
    }
  });

  it("rejects unbounded nesting at the skill boundary", () => {
    let value: unknown = {};
    for (let index = 0; index < 8; index += 1) value = { value };
    const result = parseSkillInput("ORION", value);
    expect(result.success).toBe(false);
  });
});
