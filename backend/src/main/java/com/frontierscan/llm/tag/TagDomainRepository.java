package com.frontierscan.llm.tag;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 领域注册表数据访问接口。
 * <p>
 * TagEvaluationAgent 通过 {@link #findAll()} 获取所有可用领域，
 * 用于第一步的领域分类判断。
 * </p>
 */
public interface TagDomainRepository extends JpaRepository<TagDomain, Long> {
}
