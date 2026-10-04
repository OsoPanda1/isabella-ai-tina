package com.isabella.jdr.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter authoritiesConverter = new JwtGrantedAuthoritiesConverter();
        authoritiesConverter.setAuthorityPrefix("SCOPE_");
        authoritiesConverter.setAuthoritiesClaimName("scope");
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authoritiesConverter);
        return converter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers("/actuator/health").permitAll()
                .requestMatchers("/actuator/prometheus").hasAuthority("SCOPE_read:telemetry")
                .requestMatchers(HttpMethod.GET, "/api/v1/characters/**").hasAuthority("SCOPE_read:characters")
                .requestMatchers(HttpMethod.POST, "/api/v1/characters").hasAuthority("SCOPE_write:characters")
                .requestMatchers(HttpMethod.PATCH, "/api/v1/characters/**").hasAuthority("SCOPE_write:characters")
                .requestMatchers(HttpMethod.DELETE, "/api/v1/characters/**").hasAuthority("SCOPE_delete:characters")
                .requestMatchers(HttpMethod.GET, "/api/v1/memory-links").hasAuthority("SCOPE_read:memory")
                .requestMatchers(HttpMethod.POST, "/api/v1/memory-links").hasAuthority("SCOPE_write:memory")
                .requestMatchers(HttpMethod.GET, "/api/v1/rules").hasAuthority("SCOPE_read:rules")
                .requestMatchers(HttpMethod.POST, "/api/v1/quantum/jobs").hasAuthority("SCOPE_exec:quantum")
                .requestMatchers(HttpMethod.GET, "/api/v1/quantum/jobs/**").hasAuthority("SCOPE_read:quantum")
                .requestMatchers(HttpMethod.GET, "/api/v1/audit/events").hasAuthority("SCOPE_read:audit")
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o.jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())));
        return http.build();
    }
}
