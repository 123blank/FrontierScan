package com.frontierscan.site;

import com.frontierscan.category.CategoryRepository;
import com.frontierscan.common.error.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
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
    private final CategoryRepository categoryRepository;

    public SiteService(SiteRepository siteRepository, CategoryRepository categoryRepository) {
        this.siteRepository = siteRepository;
        this.categoryRepository = categoryRepository;
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

    /**
     * 根据 ID 获取当前用户拥有的网站。
     *
     * @param userId 当前用户 ID
     * @param id 网站 ID
     * @return 网站对象
     * @throws ResourceNotFoundException 如果网站不存在或不属于当前用户
     */
    public Site getById(Long userId, Long id) {
        return siteRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new ResourceNotFoundException("网站不存在"));
    }

    /**
     * 记录站点采集失败信息。
     * <p>
     * 递增连续失败计数，写入最近失败原因、失败时间和下一次自动重试时间。
     * 站点健康状态是面向用户的长期状态，因此只在最终采集失败时调用；RSS 失败但 HTML
     * 降级成功的场景不会污染站点健康信息。
     * </p>
     *
     * @param siteId      站点 ID
     * @param reason      失败原因描述
     * @param nextRetryAt 下一次自动重试时间；超过最大重试次数时为空
     */
    @Transactional
    public void recordFailure(Long siteId, String reason, OffsetDateTime nextRetryAt) {
        siteRepository.findById(siteId).ifPresent(site -> {
            site.setConsecutiveFailures(site.getConsecutiveFailures() != null
                    ? site.getConsecutiveFailures() + 1 : 1);
            site.setLastFailureReason(reason);
            site.setLastFailureAt(OffsetDateTime.now());
            site.setNextRetryAt(nextRetryAt);
            site.setUpdatedAt(OffsetDateTime.now());
            siteRepository.save(site);
        });
    }

    /**
     * 兼容旧调用点的失败记录方法。
     * <p>没有重试时间的失败仍会递增健康计数，但不会安排自动重试。</p>
     */
    @Transactional
    public void recordFailure(Long siteId, String reason) {
        recordFailure(siteId, reason, null);
    }

    /**
     * 记录站点采集成功并恢复健康状态。
     * <p>
     * 采集链路正常完成时调用，即使本次新增文章为 0 也代表站点可访问、解析链路可用。
     * 成功后清空失败原因和重试时间，避免旧故障继续误导用户。
     * </p>
     *
     * @param siteId 站点 ID
     */
    @Transactional
    public void recordSuccess(Long siteId) {
        siteRepository.findById(siteId).ifPresent(site -> {
            site.setConsecutiveFailures(0);
            site.setLastFailureReason(null);
            site.setLastFailureAt(null);
            site.setNextRetryAt(null);
            site.setLastSuccessAt(OffsetDateTime.now());
            site.setUpdatedAt(OffsetDateTime.now());
            siteRepository.save(site);
        });
    }

    /**
     * 重置站点连续失败计数。
     * <p>
     * 保留该方法用于手动重试等显式恢复操作；真实采集成功后优先使用 {@link #recordSuccess(Long)}，
     * 以便同步更新最近成功时间。
     * </p>
     *
     * @param siteId 站点 ID
     */
    @Transactional
    public void resetFailureCount(Long siteId) {
        siteRepository.findById(siteId).ifPresent(site -> {
            site.setConsecutiveFailures(0);
            site.setLastFailureReason(null);
            site.setLastFailureAt(null);
            site.setNextRetryAt(null);
            site.setUpdatedAt(OffsetDateTime.now());
            siteRepository.save(site);
        });
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
        ensureCategoryOwnedByUser(userId, categoryId);
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

    /**
     * 更新网站配置（局部更新）。
     * <p>
     * 只允许更新当前用户拥有的网站；当传入新的分类 ID 时，也必须属于当前用户，
     * 防止网站跨用户挂载到其他人的分类下。
     * </p>
     */
    public Site update(Long userId, Long id, Long categoryId, String name, String url,
                       String rssUrl, Integer collectionIntervalMinutes, Boolean enabled) {
        Site site = getById(userId, id);
        if (categoryId != null) {
            ensureCategoryOwnedByUser(userId, categoryId);
            site.setCategoryId(categoryId);
        }
        if (name != null) site.setName(name);
        if (url != null) site.setUrl(url);
        if (rssUrl != null) site.setRssUrl(rssUrl);
        if (collectionIntervalMinutes != null) site.setCollectionIntervalMinutes(collectionIntervalMinutes);
        if (enabled != null) site.setEnabled(enabled);
        site.setUpdatedAt(OffsetDateTime.now());
        return siteRepository.save(site);
    }

    /**
     * 删除当前用户拥有的网站。
     *
     * @param userId 当前用户 ID
     * @param id 网站 ID
     */
    public void delete(Long userId, Long id) {
        Site site = getById(userId, id);
        siteRepository.delete(site);
    }

    /**
     * 校验分类是否属于当前用户。
     * <p>
     * 网站与分类都属于用户私有资源，创建/更新网站时必须确保分类归属一致。
     * </p>
     *
     * @param userId 当前用户 ID
     * @param categoryId 分类 ID
     */
    private void ensureCategoryOwnedByUser(Long userId, Long categoryId) {
        if (categoryId == null || !categoryRepository.existsByIdAndUserId(categoryId, userId)) {
            throw new ResourceNotFoundException("分类不存在");
        }
    }
}
