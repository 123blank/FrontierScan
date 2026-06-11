package com.frontierscan.category;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

/**
 * 信息分类实体，映射数据库 {@code categories} 表。
 * <p>
 * 用户可自定义分类来组织信息源，支持排序和归档操作。
 * 每个分类归属于一个用户，实现用户间的数据隔离。
 * </p>
 */
@Entity
@Table(name = "categories")
public class Category {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 所属用户 ID */
    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 分类名称 */
    @Column(nullable = false, length = 120)
    private String name;

    /** 分类描述 */
    @Column(length = 500)
    private String description;

    /** 排序序号（数字越小越靠前） */
    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    /** 是否已归档（归档后的分类在默认视图中隐藏） */
    @Column(nullable = false)
    private Boolean archived = false;

    /** 创建时间 */
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    /** 最后更新时间 */
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public Integer getSortOrder() { return sortOrder; }
    public void setSortOrder(Integer sortOrder) { this.sortOrder = sortOrder; }
    public Boolean getArchived() { return archived; }
    public void setArchived(Boolean archived) { this.archived = archived; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}