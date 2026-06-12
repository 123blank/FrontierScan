package com.frontierscan.llm.tag;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.OffsetDateTime;

/**
 * 领域注册表实体，映射 {@code tag_domains} 表。
 * <p>
 * 每行记录一个领域（如科技、金融）及其对应的标签表名。
 * TagEvaluationAgent 通过该表动态发现可用领域，再路由到对应的标签表。
 * 新增领域只需插入一行记录 + 创建对应的标签表，无需修改代码。
 * </p>
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "tag_domains")
public class TagDomain {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 领域名称，如 "科技"、"金融"，全局唯一。 */
    @Column(nullable = false, unique = true, length = 100)
    private String name;

    /** 该领域的标签表名，如 "tech_tags"、"finance_tags"，全局唯一。 */
    @Column(name = "table_name", nullable = false, unique = true, length = 100)
    private String tableName;

    /** 领域描述，可为空。 */
    @Column(length = 500)
    private String description;

    /** 排序值，数值越小越靠前。 */
    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    /** 记录创建时间。 */
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;
}
