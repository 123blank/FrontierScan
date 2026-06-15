package com.frontierscan.article;

import com.frontierscan.common.api.ApiResponse;
import com.frontierscan.common.security.JwtPrincipal;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
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
    private final ArticleSummaryService articleSummaryService;

    public ArticleController(ArticleService articleService, ArticleSummaryService articleSummaryService) {
        this.articleService = articleService;
        this.articleSummaryService = articleSummaryService;
    }

    /** 分页查询文章列表，支持按分类和来源网站筛选。 */
    @GetMapping
    public ApiResponse<Page<Article>> list(
            @AuthenticationPrincipal JwtPrincipal principal,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) Long siteId,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long tagId,
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return ApiResponse.ok(articleService.listByUser(
                principal.userId(), categoryId, siteId, keyword, tagId, startDate, endDate,
                PageRequest.of(page, size)
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

    /**
     * 手动重新生成文章摘要。
     * <p>
     * 接口只接收文章 ID，不接收 userId 或站点信息；用户归属统一从 JWT 获取并在 Service 层校验，
     * 避免前端参数被篡改后重试其他用户文章。
     * </p>
     */
    @PostMapping("/{id}/summary/retry")
    public ApiResponse<Article> retrySummary(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long id
    ) {
        return ApiResponse.ok(articleSummaryService.retrySummary(principal.userId(), id));
    }

    /** 获取当前用户的收藏列表。 */
    @GetMapping("/favorites")
    public ApiResponse<List<FavoriteArticleView>> favorites(
            @AuthenticationPrincipal JwtPrincipal principal,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long tagId,
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate
    ) {
        if (keyword != null || tagId != null || startDate != null || endDate != null) {
            OffsetDateTime start = parseDate(startDate);
            OffsetDateTime end = parseDateEnd(endDate);
            return ApiResponse.ok(articleService.listFavoriteArticlesWithFilters(
                    principal.userId(), keyword, tagId, start, end));
        }
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
    private static OffsetDateTime parseDate(String dateStr) {
        if (dateStr == null || dateStr.isBlank()) return null;
        try { return LocalDate.parse(dateStr).atStartOfDay(ZoneId.systemDefault()).toOffsetDateTime(); }
        catch (Exception e) { return null; }
    }
    private static OffsetDateTime parseDateEnd(String dateStr) {
        if (dateStr == null || dateStr.isBlank()) return null;
        try { return LocalDate.parse(dateStr).atTime(LocalTime.MAX).atZone(ZoneId.systemDefault()).toOffsetDateTime(); }
        catch (Exception e) { return null; }
    }
}
