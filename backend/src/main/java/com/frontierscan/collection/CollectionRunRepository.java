package com.frontierscan.collection;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface CollectionRunRepository extends JpaRepository<CollectionRun, Long> {
    List<CollectionRun> findByUserIdOrderByStartedAtDesc(Long userId);
    List<CollectionRun> findByUserIdAndSiteIdOrderByStartedAtDesc(Long userId, Long siteId);
}
