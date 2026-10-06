/**
 * @vitest-environment happy-dom
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIsabella } from "@/lib/useIsabella";

// Mock the Observability hook to prevent actual logging during tests
vi.mock("@/hooks/use-isabella-observability", () => ({
  useIsabellaObservability: () => ({
    logLifecycleEvent: vi.fn(),
    validatePayload: vi.fn((text, attachments) => ({ text, attachments })),
  }),
}));

describe("useIsabella Hook", () => {
  beforeEach(() => {
    // Clear storage before each test
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("should initialize with BOOT message", () => {
    const { result } = renderHook(() => useIsabella());

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe("boot");
    expect(result.current.messages[0].role).toBe("system");
  });

  it("should set and update presetId", () => {
    const { result } = renderHook(() => useIsabella());

    expect(result.current.presetId).toBe("prime"); // Default

    act(() => {
      result.current.setPresetId("strategic");
    });

    expect(result.current.presetId).toBe("strategic");
  });

  it("should purge session when reset is called", () => {
    const { result } = renderHook(() => useIsabella());

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe("system");
    expect(result.current.messages[0].content).toContain("Sesión purgada");
  });

  it("should attempt to load session from storage on mount", () => {
    const mockMessages = [
      {
        id: "test1",
        role: "user",
        content: "Test message",
        timestamp: "12:00",
      },
    ];

    window.sessionStorage.setItem(
      "isabella.session.v1",
      JSON.stringify({ messages: mockMessages }),
    );

    const { result } = renderHook(() => useIsabella());

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe("test1");
  });
});
