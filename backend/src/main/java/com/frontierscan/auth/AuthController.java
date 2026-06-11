package com.frontierscan.auth;

import com.frontierscan.common.api.ApiResponse;
import com.frontierscan.common.security.JwtPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 认证 REST 控制器。
 * <p>
 * 提供用户登录和当前登录用户信息查询接口。
 * 登录接口为公开访问，其他接口需要 JWT Token 认证。
 * </p>
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    /**
     * 用户登录。
     * <p>
     * 验证用户名密码后返回 JWT Token，客户端需在后续请求的 Authorization 头中携带此 Token。
     * </p>
     *
     * @param request 登录请求体（用户名 + 密码）
     * @return 包含 Token、用户名和角色的响应
     */
    @PostMapping("/login")
    public ApiResponse<Map<String, String>> login(@Valid @RequestBody LoginRequest request) {
        AuthService.LoginResult result = authService.login(request.username(), request.password());
        return ApiResponse.ok(Map.of(
                "token", result.token(),
                "username", result.username(),
                "role", result.role()
        ));
    }

    /**
     * 获取当前登录用户信息。
     *
     * @param principal JWT 认证用户主体（从 Token 中自动解析）
     * @return 当前用户的 ID、用户名和角色
     */
    @PostMapping("/me")
    public ApiResponse<Map<String, Object>> me(@AuthenticationPrincipal JwtPrincipal principal) {
        return ApiResponse.ok(Map.of(
                "userId", principal.userId(),
                "username", principal.username(),
                "role", principal.role()
        ));
    }

    /** 登录请求体。 */
    public record LoginRequest(
            @NotBlank(message = "用户名不能为空") String username,
            @NotBlank(message = "密码不能为空") String password
    ) {}
}