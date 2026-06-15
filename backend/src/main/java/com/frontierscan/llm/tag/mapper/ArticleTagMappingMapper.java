package com.frontierscan.llm.tag.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.frontierscan.llm.tag.mp.ArticleTagMappingPo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import java.util.List;

/**
 * 文章标签关联 MyBatis-Plus Mapper。
 * <p>
 * 本 Mapper 是标签模块 MP 化的入口，负责 {@code article_tags} 的结构化读写。
 * 查询文章 ID 时只返回关联关系本身；涉及用户数据隔离的场景必须由上层文章查询继续绑定 {@code articles.user_id}。
 * </p>
 */
@Mapper
public interface ArticleTagMappingMapper extends BaseMapper<ArticleTagMappingPo> {

    /**
     * 查询指定标签关联的文章 ID。
     * <p>收藏页和列表筛选会再结合当前用户文章集合过滤，防止标签关系表被当作跨用户访问入口。</p>
     */
    @Select("""
            select article_id
            from article_tags
            where tag_id = #{tagId}
            """)
    List<Long> findArticleIdsByTagId(@Param("tagId") Long tagId);
}
