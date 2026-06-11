package com.frontierscan.common.security;

public record JwtPrincipal(Long userId, String username, String role) {
}
