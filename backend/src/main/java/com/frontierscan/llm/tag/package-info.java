/**
 * 多领域标签评估系统。
 * <p>
 * 包含 {@link com.frontierscan.llm.tag.TagEvaluationAgent} 两阶段标签评估流程，
 * 支持通过 {@code tag_domains} 注册表动态发现领域和路由到对应标签表。
 * 新增领域只需建表 + 插入注册记录，无需修改代码。
 * </p>
 */
package com.frontierscan.llm.tag;
