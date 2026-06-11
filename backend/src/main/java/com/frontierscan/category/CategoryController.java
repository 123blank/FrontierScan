package com.frontierscan.category;

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
 * 分类管理 REST 控制器。
 * <p>
 * 提供分类的增删改查接口，支持筛选已归档分类。
 * 所有操作均基于当前认证用户进行数据隔离。
 * </p>
 */
@RestController
@RequestMapping("/api/categories")
public class CategoryController {

    private final CategoryService categoryService;

    public CategoryController(CategoryService categoryService) {
        this.categoryService = categoryService;
    }

    /** 查询分类列表。 */
    @GetMapping
    public ApiResponse<List<Category>> list(
            @AuthenticationPrincipal JwtPrincipal principal,
            @RequestParam(defaultValue = "false") boolean includeArchived
    ) {
        return ApiResponse.ok(categoryService.listByUser(principal.userId(), includeArchived));
    }

    /** 获取单个分类详情。 */
    @GetMapping("/{id}")
    public ApiResponse<Category> get(@PathVariable Long id) {
        return ApiResponse.ok(categoryService.getById(id));
    }

    /** 创建新分类。 */
    @PostMapping
    public ApiResponse<Category> create(
            @AuthenticationPrincipal JwtPrincipal principal,
            @Valid @RequestBody CreateRequest request
    ) {
        return ApiResponse.ok(categoryService.create(
                principal.userId(), request.name(), request.description(), request.sortOrder()
        ));
    }

    /** 更新分类信息。 */
    @PutMapping("/{id}")
    public ApiResponse<Category> update(
            @PathVariable Long id,
            @Valid @RequestBody UpdateRequest request
    ) {
        return ApiResponse.ok(categoryService.update(
                id, request.name(), request.description(), request.sortOrder(), request.archived()
        ));
    }

    /** 删除分类。 */
    @DeleteMapping("/{id}")
    public ApiResponse<Map<String, String>> delete(@PathVariable Long id) {
        categoryService.delete(id);
        return ApiResponse.ok(Map.of("message", "已删除"));
    }

    /** 创建分类请求体。 */
    public record CreateRequest(@NotBlank(message = "分类名称不能为空") String name, String description, Integer sortOrder) {}
    /** 更新分类请求体（所有字段可选）。 */
    public record UpdateRequest(String name, String description, Integer sortOrder, Boolean archived) {}
}