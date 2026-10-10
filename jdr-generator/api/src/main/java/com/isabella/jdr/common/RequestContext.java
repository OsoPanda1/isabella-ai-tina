package com.isabella.jdr.common;

public final class RequestContext {
    private static final ThreadLocal<RequestContext> CURRENT = new ThreadLocal<>();

    private final String requestId;
    private final String traceId;
    private final String tenantHash;
    private final String route;
    private final long startedAtEpochMs;

    public RequestContext(String requestId, String traceId, String tenantHash, String route) {
        this.requestId = requestId;
        this.traceId = traceId;
        this.tenantHash = tenantHash;
        this.route = route;
        this.startedAtEpochMs = System.currentTimeMillis();
    }

    public String requestId() { return requestId; }
    public String traceId() { return traceId; }
    public String tenantHash() { return tenantHash; }
    public String route() { return route; }
    public long startedAtEpochMs() { return startedAtEpochMs; }

    public static RequestContext current() { return CURRENT.get(); }
    public static void set(RequestContext ctx) { CURRENT.set(ctx); }
    public static void clear() { CURRENT.remove(); }
}
