package com.isabella.jdr.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class RequestContextInterceptor implements HandlerInterceptor {
    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || requestId.isBlank() || requestId.length() > 64) {
            requestId = UUID.randomUUID().toString();
        }
        String traceId = MDC.get("traceId");
        if (traceId == null) {
            traceId = requestId;
        }
        RequestContext ctx = new RequestContext(requestId, traceId, "", request.getRequestURI());
        request.setAttribute("requestContext", ctx);
        RequestContext.set(ctx);
        MDC.put("requestId", requestId);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        RequestContext.clear();
        MDC.remove("requestId");
    }
}
