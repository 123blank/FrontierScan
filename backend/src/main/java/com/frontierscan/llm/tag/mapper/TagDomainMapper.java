package com.frontierscan.llm.tag.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.frontierscan.llm.tag.mp.TagDomainPo;
import org.apache.ibatis.annotations.Mapper;

/**
 * 标签领域 MyBatis-Plus Mapper。
 * <p>
 * 领域表用于驱动标签评估的第一阶段分类和第二阶段候选标签加载。
 * 后续新增领域时，只需要新增表结构和 {@code tag_domains} 数据，不需要新增 Java Mapper。
 * </p>
 */
@Mapper
public interface TagDomainMapper extends BaseMapper<TagDomainPo> {
}
