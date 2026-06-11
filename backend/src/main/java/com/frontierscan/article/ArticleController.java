package com.frontierscan.article;

import com.frontierscan.common.api.ApiResponse;
import com.frontierscan.common.security.JwtPrincipal;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 文章 REST 控制器。
 * <p>
 * 提供文章的分页查询、详情获取、收藏切换和统计接口。
 * 所有操作基于当前认证用户进行数据隔离。
 * </p>
 */
@RestController
@RequestMapping("/api/articles")
public class ArticleController {

    private final ArticleService articleService;

    public ArticleController(ArticleService articleService) {
        this.articleService = articleService;
    }

    /** 分页查询文章列表，支持按分类和来源网站筛选。 */
    @GetMapping
    public ApiResponse<Page<Article>> list(
            @AuthenticationPrincipal JwtPrincipal principal,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) Long siteId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return ApiResponse.ok(articleService.listByUser(
                principal.userId(), categoryId, siteId,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "collectedAt"))
        ));
    }

    /** 获取文章详情。 */
    @GetMapping("/{id}")
    public ApiResponse<Article> get(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long id
    ) {
        return ApiResponse.ok(articleService.getById(principal.userId(), id));
    }

    /** 获取当前用户的收藏列表。 */
    @GetMapping("/favorites")
    public ApiResponse<java.util.List<FavoriteArticleView>> favorites(@AuthenticationPrincipal JwtPrincipal principal) {
        return ApiResponse.ok(articleService.listFavoriteArticles(principal.userId()));
    }

    /** 切换文章收藏状态。 */
    @PostMapping("/{id}/favorite")
    public ApiResponse<Map<String, Object>> toggleFavorite(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long id
    ) {
        articleService.toggleFavorite(principal.userId(), id);
        boolean isFav = articleService.isFavorited(principal.userId(), id);
        return ApiResponse.ok(Map.of("favorited", isFav));
    }

    /** 取消文章收藏。 */
    @DeleteMapping("/{id}/favorite")
    public ApiResponse<Map<String, Object>> removeFavorite(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long id
    ) {
        articleService.removeFavorite(principal.userId(), id);
        return ApiResponse.ok(Map.of("favorited", false));
    }

    /** 获取文章统计信息（总量 + 今日采集数）。 */
    @GetMapping("/count")
    public ApiResponse<Map<String, Object>> count(@AuthenticationPrincipal JwtPrincipal principal) {
        long total = articleService.countByUser(principal.userId());
        long today = articleService.countToday(principal.userId());
        return ApiResponse.ok(Map.of("total", total, "today", today));
    }
}
