package com.frontierscan.site;

import com.frontierscan.common.api.ApiResponse;
import com.frontierscan.common.security.JwtPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 网站管理 REST 控制器。
 * <p>
 * 提供信息源网站的增删改查接口，支持按分类筛选。
 * 所有操作基于当前认证用户进行数据隔离。
 * </p>
 */
@RestController
@RequestMapping("/api/sites")
public class SiteController {

    private final SiteService siteService;

    public SiteController(SiteService siteService) {
        this.siteService = siteService;
    }

    /** 查询网站列表，可选按分类筛选。 */
    @GetMapping
    public ApiResponse<List<Site>> list(
            @AuthenticationPrincipal JwtPrincipal principal,
            @RequestParam(required = false) Long categoryId
    ) {
        return ApiResponse.ok(siteService.listByUser(principal.userId(), categoryId));
    }

    /** 获取单个网站详情。 */
    @GetMapping("/{id}")
    public ApiResponse<Site> get(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long id
    ) {
        return ApiResponse.ok(siteService.getById(principal.userId(), id));
    }

    /** 创建新的信息源网站。 */
    @PostMapping
    public ApiResponse<Site> create(
            @AuthenticationPrincipal JwtPrincipal principal,
            @Valid @RequestBody CreateRequest request
    ) {
        return ApiResponse.ok(siteService.create(
                principal.userId(), request.categoryId(), request.name(), request.url(),
                request.rssUrl(), request.collectionIntervalMinutes(), request.enabled()
        ));
    }

    /** 更新网站配置。 */
    @PutMapping("/{id}")
    public ApiResponse<Site> update(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long id,
            @Valid @RequestBody UpdateRequest request
    ) {
        return ApiResponse.ok(siteService.update(
                principal.userId(), id, request.categoryId(), request.name(), request.url(),
                request.rssUrl(), request.collectionIntervalMinutes(), request.enabled()
        ));
    }

    /** 删除网站。 */
    @DeleteMapping("/{id}")
    public ApiResponse<Map<String, String>> delete(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long id
    ) {
        siteService.delete(principal.userId(), id);
        return ApiResponse.ok(Map.of("message", "已删除"));
    }

    /** 创建网站请求体。 */
    public record CreateRequest(
            @NotBlank(message = "网站名称不能为空") String name,
            @NotBlank(message = "网站地址不能为空") String url,
            Long categoryId,
            String rssUrl, Integer collectionIntervalMinutes, Boolean enabled
    ) {}
    /** 更新网站请求体（所有字段可选）。 */
    public record UpdateRequest(
            String name, String url, Long categoryId,
            String rssUrl, Integer collectionIntervalMinutes, Boolean enabled
    ) {}
}
