package com.isabella.jdr.common;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties("jdr.rate-limit")
public class RateLimitConfig {
    private int capacity = 30;
    private int refillSeconds = 10;

    public int capacity() { return capacity; }
    public void setCapacity(int capacity) { this.capacity = capacity; }
    public int refillSeconds() { return refillSeconds; }
    public void setRefillSeconds(int refillSeconds) { this.refillSeconds = refillSeconds; }
}
