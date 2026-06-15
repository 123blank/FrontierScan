package com.frontierscan.llm.tag.mp;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.OffsetDateTime;

/**
 * 标签领域 MyBatis-Plus 持久化对象。
 * <p>
 * {@code tag_domains} 是动态标签体系的路由表，记录领域名称和对应标签表名。
 * 标签评估时先读取领域，再按领域表动态加载候选标签。
 * </p>
 */
@Data
@TableName("tag_domains")
public class TagDomainPo {

    /** 领域主键，数据库自增。 */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 领域名称，例如“科技”。 */
    private String name;

    /** 该领域对应的标签表名，例如 {@code tech_tags}。 */
    private String tableName;

    /** 领域描述，供前端或运维理解领域边界。 */
    private String description;

    /** 排序值，数值越小越靠前。 */
    private Integer sortOrder;

    /** 领域创建时间。 */
    private OffsetDateTime createdAt;
}
