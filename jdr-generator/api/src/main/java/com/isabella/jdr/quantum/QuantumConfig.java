package com.isabella.jdr.quantum;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties("jdr.quantum")
public class QuantumConfig {
    private int maxWires = 64;
    private int maxShots = 8192;
    private int maxOperations = 2000;
    private int timeoutSeconds = 30;
    private int defaultWires = 32;
    private int defaultShots = 1024;

    public int maxWires() { return maxWires; }
    public void setMaxWires(int maxWires) { this.maxWires = maxWires; }
    public int maxShots() { return maxShots; }
    public void setMaxShots(int maxShots) { this.maxShots = maxShots; }
    public int maxOperations() { return maxOperations; }
    public void setMaxOperations(int maxOperations) { this.maxOperations = maxOperations; }
    public int timeoutSeconds() { return timeoutSeconds; }
    public void setTimeoutSeconds(int timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }
    public int defaultWires() { return defaultWires; }
    public void setDefaultWires(int defaultWires) { this.defaultWires = defaultWires; }
    public int defaultShots() { return defaultShots; }
    public void setDefaultShots(int defaultShots) { this.defaultShots = defaultShots; }
}
