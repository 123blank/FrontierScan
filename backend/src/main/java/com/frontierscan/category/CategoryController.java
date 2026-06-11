package com.frontierscan.category;

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
@RequestMapping("/api/categories")
public class CategoryController {

    private final CategoryService categoryService;

    public CategoryController(CategoryService categoryService) {
        this.categoryService = categoryService;
    }

    @GetMapping
    public ApiResponse<List<Category>> list(
            @AuthenticationPrincipal JwtPrincipal principal,
            @RequestParam(defaultValue = "false") boolean includeArchived
    ) {
        return ApiResponse.ok(categoryService.listByUser(principal.userId(), includeArchived));
    }

    @GetMapping("/{id}")
    public ApiResponse<Category> get(@PathVariable Long id) {
        return ApiResponse.ok(categoryService.getById(id));
    }

    @PostMapping
    public ApiResponse<Category> create(
            @AuthenticationPrincipal JwtPrincipal principal,
            @Valid @RequestBody CreateRequest request
    ) {
        return ApiResponse.ok(categoryService.create(
                principal.userId(), request.name(), request.description(), request.sortOrder()
        ));
    }

    @PutMapping("/{id}")
    public ApiResponse<Category> update(
            @PathVariable Long id,
            @Valid @RequestBody UpdateRequest request
    ) {
        return ApiResponse.ok(categoryService.update(
                id, request.name(), request.description(), request.sortOrder(), request.archived()
        ));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Map<String, String>> delete(@PathVariable Long id) {
        categoryService.delete(id);
        return ApiResponse.ok(Map.of("message", "已删除"));
    }

    public record CreateRequest(@NotBlank String name, String description, Integer sortOrder) {}
    public record UpdateRequest(String name, String description, Integer sortOrder, Boolean archived) {}
}
