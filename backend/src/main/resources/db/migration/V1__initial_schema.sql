create table app_users (
    id bigserial primary key,
    username varchar(100) not null unique,
    password_hash varchar(255) not null,
    role varchar(40) not null,
    status varchar(40) not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table categories (
    id bigserial primary key,
    user_id bigint not null references app_users(id),
    name varchar(120) not null,
    description varchar(500),
    sort_order integer not null default 0,
    archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table sites (
    id bigserial primary key,
    user_id bigint not null references app_users(id),
    category_id bigint not null references categories(id),
    name varchar(160) not null,
    url varchar(1000) not null,
    rss_url varchar(1000),
    collection_interval_minutes integer not null default 1440,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table articles (
    id bigserial primary key,
    user_id bigint not null references app_users(id),
    site_id bigint not null references sites(id),
    category_id bigint not null references categories(id),
    title varchar(500) not null,
    summary text,
    key_points text,
    tags varchar(1000),
    content_excerpt text,
    source_url varchar(1200) not null,
    source_hash varchar(128) not null,
    published_at timestamptz,
    collected_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (user_id, source_hash)
);

create table collection_runs (
    id bigserial primary key,
    user_id bigint not null references app_users(id),
    site_id bigint references sites(id),
    run_type varchar(40) not null,
    status varchar(40) not null,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    collected_count integer not null default 0,
    error_message text
);

create table favorites (
    id bigserial primary key,
    user_id bigint not null references app_users(id),
    article_id bigint not null references articles(id),
    created_at timestamptz not null default now(),
    unique (user_id, article_id)
);
