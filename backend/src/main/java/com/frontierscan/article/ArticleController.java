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

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/articles")
public class ArticleController {

    private final ArticleService articleService;

    public ArticleController(ArticleService articleService) {
        this.articleService = articleService;
    }

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

    @GetMapping("/{id}")
    public ApiResponse<Article> get(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long id
    ) {
        return ApiResponse.ok(articleService.getById(principal.userId(), id));
    }

    @GetMapping("/favorites")
    public ApiResponse<List<Map<String, Object>>> favorites(@AuthenticationPrincipal JwtPrincipal principal) {
        List<Favorite> favs = articleService.listFavorites(principal.userId());
        List<Map<String, Object>> data = favs.stream().map(f -> Map.<String, Object>of(
                "id", f.getId(),
                "articleId", f.getArticleId(),
                "createdAt", f.getCreatedAt().toString()
        )).toList();
        return ApiResponse.ok(data);
    }

    @PostMapping("/{id}/favorite")
    public ApiResponse<Map<String, Object>> toggleFavorite(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long id
    ) {
        articleService.toggleFavorite(principal.userId(), id);
        boolean isFav = articleService.isFavorited(principal.userId(), id);
        return ApiResponse.ok(Map.of("favorited", isFav));
    }

    @DeleteMapping("/{id}/favorite")
    public ApiResponse<Map<String, Object>> removeFavorite(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long id
    ) {
        articleService.toggleFavorite(principal.userId(), id);
        return ApiResponse.ok(Map.of("favorited", false));
    }

    @GetMapping("/count")
    public ApiResponse<Map<String, Object>> count(@AuthenticationPrincipal JwtPrincipal principal) {
        long total = articleService.countByUser(principal.userId());
        long today = articleService.countToday(principal.userId());
        return ApiResponse.ok(Map.of("total", total, "today", today));
    }
}
