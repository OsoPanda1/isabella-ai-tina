package com.isabella.jdr.common;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class RateLimitFilter extends OncePerRequestFilter {
    private final RateLimitConfig config;
    private final ConcurrentHashMap<String, RateLimitBucketConfig.Bucket> buckets;
    private final MeterRegistry meterRegistry;

    public RateLimitFilter(RateLimitConfig config,
                           ConcurrentHashMap<String, RateLimitBucketConfig.Bucket> buckets,
                           MeterRegistry meterRegistry) {
        this.config = config;
        this.buckets = buckets;
        this.meterRegistry = meterRegistry;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String key = keyFor(request);
        RateLimitBucketConfig.Bucket bucket = buckets.computeIfAbsent(key,
            k -> new RateLimitBucketConfig.Bucket(config.capacity(), config.refillSeconds()));
        if (!bucket.tryConsume()) {
            int retry = config.refillSeconds();
            long reset = (System.currentTimeMillis() / 1000L) + retry;
            response.setStatus(429);
            response.addHeader("Retry-After", String.valueOf(retry));
            response.addHeader("X-RateLimit-Limit", String.valueOf(config.capacity()));
            response.addHeader("X-RateLimit-Remaining", "0");
            response.addHeader("X-RateLimit-Reset", String.valueOf(reset));
            meterRegistry.counter("jdr_ratelimit_rejected_total").increment();
            return;
        }
        response.addHeader("X-RateLimit-Limit", String.valueOf(config.capacity()));
        response.addHeader("X-RateLimit-Remaining", String.valueOf(bucket.remaining()));
        chain.doFilter(request, response);
    }

    private String keyFor(HttpServletRequest request) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof Jwt jwtAuth) {
            Jwt jwt = jwtAuth;
            String tenant = jwt.getClaimAsString("tenantId");
            String sub = jwt.getSubject();
            String client = jwt.getClaimAsString("client_id");
            return "t=" + (tenant == null ? "?" : tenant)
                + "|s=" + (sub == null ? "?" : sub)
                + "|c=" + (client == null ? "?" : client)
                + "|p=" + clientIp(request);
        }
        return "ip=" + clientIp(request);
    }

    private String clientIp(HttpServletRequest request) {
        String fwd = request.getHeader("X-Forwarded-For");
        if (fwd != null && !fwd.isBlank()) {
            return fwd.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
