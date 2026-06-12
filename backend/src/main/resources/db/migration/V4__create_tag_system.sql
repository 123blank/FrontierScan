-- ============================================================
-- V4: 标签系统 - 多领域标签表 + 文章标签关联表
-- 为文章搜索筛选、标签评估 Agent 提供数据库支持。
-- 每个领域独立建表（如 tech_tags），通过 tag_domains 注册表路由。
-- ============================================================

-- ============================================================
-- tag_domains - 领域注册表
-- 每行记录一个领域及其对应的标签表名，支持动态扩展。
-- ============================================================
create table tag_domains (
    id bigserial primary key,
    name varchar(100) not null unique,
    table_name varchar(100) not null unique,
    description varchar(500),
    sort_order int not null default 0,
    created_at timestamp with time zone not null default now()
);

comment on table tag_domains is '领域注册表，记录每个领域的名称及其对应的标签表名，支持动态扩展新领域。';
comment on column tag_domains.id is '领域主键 ID，自增。';
comment on column tag_domains.name is '领域名称，例如科技、金融、医疗，全局唯一。';
comment on column tag_domains.table_name is '该领域的标签表名，例如 tech_tags、finance_tags，全局唯一。';
comment on column tag_domains.description is '领域描述，可为空。';
comment on column tag_domains.sort_order is '排序值，数值越小越靠前。';
comment on column tag_domains.created_at is '记录创建时间。';

-- ============================================================
-- tech_tags - 科技领域标签表
-- 初始约 35 个科技领域标签，覆盖 AI、基础技术、工程实践、科技商业四大类。
-- ============================================================
create table tech_tags (
    id bigserial primary key,
    name varchar(100) not null unique,
    description varchar(500),
    created_at timestamp with time zone not null default now()
);

comment on table tech_tags is '科技领域标签表，存储科技领域下所有预置标签。';
comment on column tech_tags.id is '标签主键 ID，自增。';
comment on column tech_tags.name is '标签名称，领域内唯一。';
comment on column tech_tags.description is '标签描述，可为空。';
comment on column tech_tags.created_at is '记录创建时间。';

-- ============================================================
-- article_tags - 文章标签关联表（多态关联）
-- 通过 tag_domain 字段区分标签来自哪个领域，不设外键约束以兼容多领域。
-- ============================================================
create table article_tags (
    id bigserial primary key,
    article_id bigint not null references articles(id) on delete cascade,
    tag_id bigint not null,
    tag_domain varchar(50) not null,
    created_at timestamp with time zone not null default now(),
    unique(article_id, tag_id, tag_domain)
);

comment on table article_tags is '文章标签关联表，记录文章与 Tag 的多对多关系，支持跨领域标签。';
comment on column article_tags.id is '关联记录主键 ID，自增。';
comment on column article_tags.article_id is '文章 ID，引用 articles.id，级联删除。';
comment on column article_tags.tag_id is '标签 ID，不设外键约束，兼容多领域标签表。';
comment on column article_tags.tag_domain is '标签所属领域名称，与 tag_domains.name 逻辑关联。';
comment on column article_tags.created_at is '记录创建时间。';

-- ============================================================
-- 索引
-- ============================================================
create index idx_article_tags_article_id on article_tags(article_id);
create index idx_article_tags_tag_domain on article_tags(tag_domain);

-- ============================================================
-- 种子数据：插入科技领域及其标签
-- ============================================================
insert into tag_domains (name, table_name, description, sort_order) values
    ('科技', 'tech_tags', '科技领域，覆盖 AI、基础技术、工程实践和科技商业', 1);

-- AI 技术核心
insert into tech_tags (name, description) values
    ('人工智能', '人工智能及其应用'),
    ('大模型', '大语言模型（LLM）及相关技术'),
    ('机器学习', '机器学习算法与系统'),
    ('深度学习', '深度神经网络与训练'),
    ('自然语言处理', 'NLP 技术，包括文本理解、生成、翻译等'),
    ('计算机视觉', 'CV 技术，包括图像识别、目标检测、图像生成等'),
    ('强化学习', '强化学习算法与应用'),
    ('数据分析', '数据分析、数据挖掘与商业智能'),
    ('算法', '算法设计与分析');

-- 基础技术
insert into tech_tags (name, description) values
    ('云计算', '云服务、云原生基础设施'),
    ('大数据', '大数据存储、处理与分析'),
    ('数据库', '关系型/非关系型数据库、数据仓库'),
    ('网络安全', '信息安全、网络攻防、隐私保护'),
    ('前端开发', 'Web 前端、移动端开发技术'),
    ('后端开发', '服务端开发、API 设计与实现'),
    ('移动开发', 'iOS、Android 及跨平台移动开发'),
    ('架构设计', '系统架构、微服务、分布式设计'),
    ('DevOps', 'CI/CD、自动化运维、基础设施即代码'),
    ('性能优化', '系统性能分析与调优'),
    ('测试', '自动化测试、质量保障');

-- 工程实践
insert into tech_tags (name, description) values
    ('开源', '开源项目、开源社区与生态'),
    ('编程语言', '编程语言特性、对比与最佳实践'),
    ('系统设计', '大规模系统设计原则与模式'),
    ('API 设计', 'RESTful/gRPC/GraphQL 等 API 设计规范'),
    ('微服务', '微服务架构、服务治理与通信'),
    ('容器化', 'Docker、Kubernetes 等容器技术'),
    ('持续集成', 'CI/CD 流水线、自动化构建与部署'),
    ('监控与可观测性', '日志、指标、链路追踪与监控告警');

-- 科技商业
insert into tech_tags (name, description) values
    ('科技商业', '科技公司的商业模式、战略与市场分析'),
    ('产品设计', '产品设计、用户体验与交互设计'),
    ('行业趋势', '科技行业发展趋势与前沿动态'),
    ('创业', '科技创新、创业经验与案例'),
    ('投融资', '科技投融资动态与资本市场分析');
