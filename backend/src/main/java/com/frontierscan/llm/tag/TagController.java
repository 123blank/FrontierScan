package com.frontierscan.llm.tag;

import com.frontierscan.common.api.ApiResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;
import java.util.Map;

/**
 * 标签管理 REST 控制器。
 * <p>
 * 提供标签领域查询接口，供前端筛选栏使用。
 * 通过 {@code tag_domains} 注册表动态发现领域，通过 JdbcTemplate 动态查询各领域标签表。
 * </p>
 */
@RestController
@RequestMapping("/api/tags")
public class TagController {

    private final TagDomainRepository tagDomainRepository;
    private final JdbcTemplate jdbcTemplate;

    public TagController(TagDomainRepository tagDomainRepository, JdbcTemplate jdbcTemplate) {
        this.tagDomainRepository = tagDomainRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 获取所有标签领域及其标签列表。
     * <p>
     * 返回所有领域及其下面的全部标签，供前端筛选栏使用。
     * 通过 tag_domains.table_name 动态路由到各领域标签表。
     * </p>
     */
    @GetMapping("/domains")
    public ApiResponse<List<Map<String, Object>>> listDomains() {
        List<TagDomain> domains = tagDomainRepository.findAll();
        List<Map<String, Object>> result = domains.stream()
                .map(domain -> {
                    List<Map<String, Object>> tags = jdbcTemplate.query(
                            "SELECT id, name, description FROM " + domain.getTableName() + " ORDER BY id",
                            (rs, rowNum) -> Map.of(
                                    "id", rs.getLong("id"),
                                    "name", rs.getString("name"),
                                    "description", rs.getString("description") != null ? rs.getString("description") : ""
                            ));
                    return Map.<String, Object>of(
                            "id", domain.getId(),
                            "name", domain.getName(),
                            "tags", tags
                    );
                })
                .toList();
        return ApiResponse.ok(result);
    }

    /**
     * 获取指定领域的所有标签。
     * domainName 与 tag_domains.name 匹配（如 "科技"）。
     */
    @GetMapping("/domains/{domainName}")
    public ApiResponse<List<Map<String, Object>>> listTagsByDomain(@PathVariable String domainName) {
        TagDomain domain = tagDomainRepository.findAll().stream()
                .filter(d -> d.getName().equals(domainName))
                .findFirst()
                .orElse(null);
        if (domain == null) {
            return ApiResponse.ok(List.of());
        }
        List<Map<String, Object>> tags = jdbcTemplate.query(
                "SELECT id, name, description FROM " + domain.getTableName() + " ORDER BY id",
                (rs, rowNum) -> Map.of(
                        "id", rs.getLong("id"),
                        "name", rs.getString("name"),
                        "description", rs.getString("description") != null ? rs.getString("description") : ""
                ));
        return ApiResponse.ok(tags);
    }
}
