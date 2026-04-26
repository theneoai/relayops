-- 为Langfuse和Windmill创建独立数据库
CREATE DATABASE langfuse;
CREATE DATABASE windmill;

-- 给postgres用户授予权限
GRANT ALL PRIVILEGES ON DATABASE langfuse TO postgres;
GRANT ALL PRIVILEGES ON DATABASE windmill TO postgres;

-- Langfuse需要使用uuid-ossp
\c langfuse
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Windmill需要使用uuid-ossp
\c windmill
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
