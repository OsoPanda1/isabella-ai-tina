package com.isabella.jdr.outbox;

public interface EventPublisher {
    void publish(OutboxEntity event);
}
