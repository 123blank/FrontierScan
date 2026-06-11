package com.frontierscan.collection;

import com.frontierscan.site.Site;

/**
 * 采集器策略接口。
 * <p>
 * 每种内容源类型实现此接口，通过 {@link #sourceType()} 标识。
 * 当前内置 RSS/Atom 和 HTML 网页两种实现，后续可扩展如 API 采集器等。
 * 采用策略模式，由 {@link CollectionOrchestrator} 根据 Site 配置动态选择。
 * </p>
 */
public interface Collector {

    /** 返回采集器类型标识，如 "RSS"、"HTML"。 */
    String sourceType();

    /**
     * 执行采集。
     *
     * @param site 信息源网站配置
     * @return 采集结果，含原始文章列表和采集元信息
     * @throws CollectorException 采集过程中可恢复的异常
     */
    CollectResult collect(Site site);
}