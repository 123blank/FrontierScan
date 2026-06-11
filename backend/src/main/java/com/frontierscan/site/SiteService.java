package com.frontierscan.site;

import org.springframework.stereotype.Service;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 网站管理业务服务，提供网站的完整 CRUD 操作。
 * <p>
 * 支持按用户和分类维度查询、创建/更新网站配置，以及删除操作。
 * </p>
 */
@Service
public class SiteService {

    private final SiteRepository siteRepository;

    public SiteService(SiteRepository siteRepository) {
        this.siteRepository = siteRepository;
    }

    /**
     * 查询指定用户的网站列表。
     *
     * @param userId     用户 ID
     * @param categoryId 可选分类 ID，不为 null 时按分类筛选
     * @return 网站列表
     */
    public List<Site> listByUser(Long userId, Long categoryId) {
        if (categoryId != null) {
            return siteRepository.findByUserIdAndCategoryId(userId, categoryId);
        }
        return siteRepository.findByUserId(userId);
    }

    /** 根据 ID 获取网站。 */
    public Site getById(Long id) {
        return siteRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("网站不存在"));
    }

    /**
     * 创建新的信息源网站。
     *
     * @param userId                 所属用户 ID
     * @param categoryId             所属分类 ID
     * @param name                   网站名称
     * @param url                    网站地址
     * @param rssUrl                 RSS 地址（可选）
     * @param collectionIntervalMinutes 采集间隔分钟数（可选，默认 1440）
     * @param enabled                是否启用（可选，默认启用）
     * @return 创建成功的网站对象
     */
    public Site create(Long userId, Long categoryId, String name, String url,
                       String rssUrl, Integer collectionIntervalMinutes, Boolean enabled) {
        Site site = new Site();
        site.setUserId(userId);
        site.setCategoryId(categoryId);
        site.setName(name);
        site.setUrl(url);
        site.setRssUrl(rssUrl);
        site.setCollectionIntervalMinutes(collectionIntervalMinutes != null ? collectionIntervalMinutes : 1440);
        site.setEnabled(enabled != null ? enabled : true);
        site.setCreatedAt(OffsetDateTime.now());
        site.setUpdatedAt(OffsetDateTime.now());
        return siteRepository.save(site);
    }

    /** 更新网站配置（局部更新）。 */
    public Site update(Long id, Long categoryId, String name, String url,
                       String rssUrl, Integer collectionIntervalMinutes, Boolean enabled) {
        Site site = getById(id);
        if (categoryId != null) site.setCategoryId(categoryId);
        if (name != null) site.setName(name);
        if (url != null) site.setUrl(url);
        if (rssUrl != null) site.setRssUrl(rssUrl);
        if (collectionIntervalMinutes != null) site.setCollectionIntervalMinutes(collectionIntervalMinutes);
        if (enabled != null) site.setEnabled(enabled);
        site.setUpdatedAt(OffsetDateTime.now());
        return siteRepository.save(site);
    }

    /** 删除网站。 */
    public void delete(Long id) {
        siteRepository.deleteById(id);
    }
}