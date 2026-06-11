-- ============================================================
-- V3: 数据库表与字段说明
-- 为 FrontierScan 业务表补充 PostgreSQL COMMENT 描述，便于数据库运维、
-- 数据治理、接口排查和新人交接时直接理解表结构语义。
-- ============================================================

-- ============================================================
-- app_users - 用户账号
-- ============================================================
comment on table app_users is '用户账号表，存储系统登录用户、角色和账号状态。';

comment on column app_users.id is '用户主键 ID，自增。';
comment on column app_users.username is '登录用户名，全局唯一。';
comment on column app_users.password_hash is '用户密码哈希值，禁止存储明文密码。';
comment on column app_users.role is '用户角色，例如 ADMIN、USER。';
comment on column app_users.status is '账号状态，例如 ACTIVE、DISABLED。';
comment on column app_users.created_at is '账号创建时间。';
comment on column app_users.updated_at is '账号最近更新时间。';

-- ============================================================
-- categories - 信息分类
-- ============================================================
comment on table categories is '信息分类表，存储用户自定义的资讯分类，用于组织站点和文章。';

comment on column categories.id is '分类主键 ID，自增。';
comment on column categories.user_id is '分类所属用户 ID，引用 app_users.id，用于用户数据隔离。';
comment on column categories.name is '分类名称。';
comment on column categories.description is '分类描述，可为空。';
comment on column categories.sort_order is '分类排序值，数值越小越靠前。';
comment on column categories.archived is '是否已归档；归档后默认不在普通列表中展示。';
comment on column categories.created_at is '分类创建时间。';
comment on column categories.updated_at is '分类最近更新时间。';

-- ============================================================
-- sites - 信息源网站
-- ============================================================
comment on table sites is '信息源网站表，存储用户添加的待采集站点及采集调度配置。';

comment on column sites.id is '网站主键 ID，自增。';
comment on column sites.user_id is '网站所属用户 ID，引用 app_users.id，用于用户数据隔离。';
comment on column sites.category_id is '网站所属分类 ID，引用 categories.id。';
comment on column sites.name is '网站名称。';
comment on column sites.url is '网站主页 URL，用于 HTML 降级采集和来源展示。';
comment on column sites.rss_url is 'RSS/Atom 订阅地址，可为空；非空时优先使用 RSS 采集。';
comment on column sites.collection_interval_minutes is '定时采集间隔，单位分钟；默认 1440 分钟。';
comment on column sites.enabled is '是否启用采集；禁用后定时调度不再扫描该站点。';
comment on column sites.created_at is '网站配置创建时间。';
comment on column sites.updated_at is '网站配置最近更新时间。';

-- ============================================================
-- articles - 采集文章
-- ============================================================
comment on table articles is '采集文章表，存储从信息源采集并经 LLM 处理后的文章内容。';

comment on column articles.id is '文章主键 ID，自增。';
comment on column articles.user_id is '文章所属用户 ID，引用 app_users.id，用于用户数据隔离。';
comment on column articles.site_id is '来源网站 ID，引用 sites.id。';
comment on column articles.category_id is '文章所属分类 ID，引用 categories.id，冗余保存便于按分类查询。';
comment on column articles.title is '文章标题；可能被 LLM 优化后的标题覆盖。';
comment on column articles.summary is 'LLM 生成的文章摘要，可为空。';
comment on column articles.key_points is 'LLM 生成的关键要点，多条要点以换行符分隔，可为空。';
comment on column articles.tags is 'LLM 生成或系统提取的标签，多个标签以逗号分隔，可为空。';
comment on column articles.content_excerpt is '采集器提取的正文片段或摘要文本，用于展示和 LLM 输入。';
comment on column articles.source_url is '文章原始来源 URL。';
comment on column articles.source_hash is '文章去重哈希，通常基于来源 URL 生成；与 user_id 组成唯一约束。';
comment on column articles.published_at is '文章原始发布时间，无法解析时为空。';
comment on column articles.collected_at is '系统采集入库时间。';
comment on column articles.created_at is '文章记录创建时间。';

-- ============================================================
-- collection_runs - 采集任务记录
-- ============================================================
comment on table collection_runs is '采集任务记录表，记录手动和定时采集任务的执行状态、耗时和结果。';

comment on column collection_runs.id is '采集任务主键 ID，自增。';
comment on column collection_runs.user_id is '任务所属用户 ID，引用 app_users.id，用于用户数据隔离。';
comment on column collection_runs.site_id is '目标网站 ID，引用 sites.id；为空时表示全量或非站点级任务。';
comment on column collection_runs.run_type is '任务类型，例如 MANUAL（手动）或 SCHEDULED（定时）。';
comment on column collection_runs.status is '任务状态，例如 RUNNING、COMPLETED、FAILED。';
comment on column collection_runs.started_at is '任务开始时间。';
comment on column collection_runs.finished_at is '任务结束时间；任务运行中时为空。';
comment on column collection_runs.collected_count is '本次任务实际新增入库的文章数量。';
comment on column collection_runs.error_message is '任务失败时记录的错误信息；成功时为空。';

-- ============================================================
-- favorites - 用户收藏关系
-- ============================================================
comment on table favorites is '用户收藏关系表，记录用户收藏的文章。';

comment on column favorites.id is '收藏记录主键 ID，自增。';
comment on column favorites.user_id is '收藏所属用户 ID，引用 app_users.id，用于用户数据隔离。';
comment on column favorites.article_id is '被收藏文章 ID，引用 articles.id。';
comment on column favorites.created_at is '收藏创建时间。';
