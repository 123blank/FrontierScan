package com.frontierscan.site;

import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.List;

@Service
public class SiteService {

    private final SiteRepository siteRepository;

    public SiteService(SiteRepository siteRepository) {
        this.siteRepository = siteRepository;
    }

    public List<Site> listByUser(Long userId, Long categoryId) {
        if (categoryId != null) {
            return siteRepository.findByUserIdAndCategoryId(userId, categoryId);
        }
        return siteRepository.findByUserId(userId);
    }

    public Site getById(Long id) {
        return siteRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("网站不存在"));
    }

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

    public void delete(Long id) {
        siteRepository.deleteById(id);
    }
}
