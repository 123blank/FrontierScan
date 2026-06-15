package com.frontierscan.llm.tag.mp;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.OffsetDateTime;

/**
 * 文章标签关联 MyBatis-Plus 持久化对象。
 * <p>
 * 本类映射 {@code article_tags} 表，是项目后续以 MyBatis-Plus 为主的数据访问试点。
 * 该表不直接保存 {@code userId}，用户隔离边界由文章查询或上游文章归属校验保证，避免仅凭标签关系表跨用户读取数据。
 * </p>
 */
@Data
@TableName("article_tags")
public class ArticleTagMappingPo {

    /** 关联记录主键，数据库自增。 */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 文章 ID，对应 {@code articles.id}。 */
    private Long articleId;

    /** 标签 ID，对应某个领域标签表中的主键。 */
    private Long tagId;

    /** 标签所属领域名称，对应 {@code tag_domains.name}。 */
    private String tagDomain;

    /** 关联创建时间。 */
    private OffsetDateTime createdAt;
}
