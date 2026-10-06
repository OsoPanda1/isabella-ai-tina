package com.isabella.jdr.common;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RateLimitBucketConfig {

    public static final class Bucket {
        private final int capacity;
        private final int refillSeconds;
        private final AtomicLong tokens;
        private volatile long lastRefillNanos;

        public Bucket(int capacity, int refillSeconds) {
            this.capacity = capacity;
            this.refillSeconds = refillSeconds;
            this.tokens = new AtomicLong(capacity);
            this.lastRefillNanos = System.nanoTime();
        }

        public synchronized boolean tryConsume() {
            long now = System.nanoTime();
            long elapsed = now - lastRefillNanos;
            if (elapsed > 0) {
                long added = (elapsed / 1_000_000_000L) * capacity / refillSeconds;
                if (added > 0) {
                    long cur = Math.min(capacity, tokens.get() + added);
                    tokens.set(cur);
                    lastRefillNanos = now;
                }
            }
            if (tokens.get() >= 1) {
                tokens.decrementAndGet();
                return true;
            }
            return false;
        }

        public long remaining() {
            return Math.max(0, tokens.get());
        }
    }

    @Bean
    public ConcurrentHashMap<String, Bucket> rateLimitBuckets() {
        return new ConcurrentHashMap<>();
    }
}
