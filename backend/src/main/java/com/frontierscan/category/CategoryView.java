package com.frontierscan.category;

import java.time.OffsetDateTime;

/**
 * Category response enriched with usage counters for management and navigation.
 */
public record CategoryView(
        Long id,
        Long userId,
        String name,
        String description,
        Integer sortOrder,
        Boolean archived,
        long siteCount,
        long articleCount,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
    public static CategoryView of(Category category, long siteCount, long articleCount) {
        return new CategoryView(
                category.getId(),
                category.getUserId(),
                category.getName(),
                category.getDescription(),
                category.getSortOrder(),
                category.getArchived(),
                siteCount,
                articleCount,
                category.getCreatedAt(),
                category.getUpdatedAt()
        );
    }
}
