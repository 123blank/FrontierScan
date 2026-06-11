package com.frontierscan.site;

import com.frontierscan.common.api.ApiResponse;
import com.frontierscan.common.security.JwtPrincipal;
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

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/sites")
public class SiteController {

    private final SiteService siteService;

    public SiteController(SiteService siteService) {
        this.siteService = siteService;
    }

    @GetMapping
    public ApiResponse<List<Site>> list(
            @AuthenticationPrincipal JwtPrincipal principal,
            @RequestParam(required = false) Long categoryId
    ) {
        return ApiResponse.ok(siteService.listByUser(principal.userId(), categoryId));
    }

    @GetMapping("/{id}")
    public ApiResponse<Site> get(@PathVariable Long id) {
        return ApiResponse.ok(siteService.getById(id));
    }

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

    @PutMapping("/{id}")
    public ApiResponse<Site> update(
            @PathVariable Long id,
            @Valid @RequestBody UpdateRequest request
    ) {
        return ApiResponse.ok(siteService.update(
                id, request.categoryId(), request.name(), request.url(),
                request.rssUrl(), request.collectionIntervalMinutes(), request.enabled()
        ));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Map<String, String>> delete(@PathVariable Long id) {
        siteService.delete(id);
        return ApiResponse.ok(Map.of("message", "已删除"));
    }

    public record CreateRequest(
            @NotBlank String name, @NotBlank String url, Long categoryId,
            String rssUrl, Integer collectionIntervalMinutes, Boolean enabled
    ) {}
    public record UpdateRequest(
            String name, String url, Long categoryId,
            String rssUrl, Integer collectionIntervalMinutes, Boolean enabled
    ) {}
}
