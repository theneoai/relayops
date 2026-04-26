#!/bin/bash
# Agent Platform MVP — 初始化脚本
set -e

echo "🔧 Initializing Agent Platform MVP..."

# 创建密钥目录
mkdir -p secrets
chmod 700 secrets 2>/dev/null || true

# 复制环境变量模板
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ Created .env from template"
else
    echo "⚠️  .env already exists, skipping"
fi

# 生成 JWT 密钥
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | head -c 64 | xxd -p | head -1)
if grep -q "JWT_SECRET=auto-generated-by-init" .env; then
    sed -i.bak "s/JWT_SECRET=auto-generated-by-init/JWT_SECRET=$JWT_SECRET/" .env && rm -f .env.bak
    echo "✅ Generated JWT_SECRET"
else
    echo "⚠️  JWT_SECRET already set, skipping"
fi

# 生成 PostgreSQL 密码
DB_PASS=$(openssl rand -hex 16 2>/dev/null || cat /dev/urandom | head -c 32 | xxd -p | head -1)
if grep -q "POSTGRES_PASSWORD=changeme" .env; then
    sed -i.bak "s/POSTGRES_PASSWORD=changeme/POSTGRES_PASSWORD=$DB_PASS/" .env && rm -f .env.bak
    sed -i.bak "s/:changeme@postgres/:$DB_PASS@postgres/" .env && rm -f .env.bak
    echo "✅ Generated PostgreSQL password"
else
    echo "⚠️  PostgreSQL password already set, skipping"
fi

# 生成 Grafana 密码
GRAFANA_PASS=$(openssl rand -hex 8 2>/dev/null || echo "admin")
if grep -q "GRAFANA_PASSWORD=admin" .env; then
    sed -i.bak "s/GRAFANA_PASSWORD=admin/GRAFANA_PASSWORD=$GRAFANA_PASS/" .env && rm -f .env.bak
    echo "✅ Generated Grafana password: $GRAFANA_PASS"
else
    echo "⚠️  Grafana password already set, skipping"
fi

# 生成 Langfuse 加密密钥（64位hex，256bit）
LANGFUSE_KEY=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | head -c 64 | xxd -p | head -1)
if [ -f config/langfuse/.env ]; then
    if grep -q "ENCRYPTION_KEY=" config/langfuse/.env; then
        sed -i.bak "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$LANGFUSE_KEY/" config/langfuse/.env && rm -f config/langfuse/.env.bak
        echo "✅ Generated Langfuse ENCRYPTION_KEY"
    else
        echo "ENCRYPTION_KEY=$LANGFUSE_KEY" >> config/langfuse/.env
        echo "✅ Generated Langfuse ENCRYPTION_KEY"
    fi
else
    mkdir -p config/langfuse
    cat > config/langfuse/.env <<EOF
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_NAME=langfuse
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=${DB_PASS:-changeme}
NEXTAUTH_URL=http://localhost:3002
NEXTAUTH_SECRET=changeme-langfuse-secret-32-char-long
SALT=changeme-langfuse-salt-16-char
ENCRYPTION_KEY=$LANGFUSE_KEY
TELEMETRY_ENABLED=false
EOF
    echo "✅ Created config/langfuse/.env with ENCRYPTION_KEY"
fi

# 同步数据库密码到 Langfuse 配置
if [ -f config/langfuse/.env ] && [ -f .env ]; then
    CURRENT_DB_PASS=$(grep "POSTGRES_PASSWORD=" .env | cut -d= -f2 | head -1)
    if [ -n "$CURRENT_DB_PASS" ]; then
        sed -i.bak "s/DATABASE_PASSWORD=.*/DATABASE_PASSWORD=$CURRENT_DB_PASS/" config/langfuse/.env && rm -f config/langfuse/.env.bak
        echo "✅ Synced database password to Langfuse config"
    fi
fi

echo ""
echo "🎉 Initialization complete!"
echo ""
echo "Next steps:"
echo "  1. Review .env and customize if needed"
echo "  2. Run: make up"
echo "  3. Run: make demo"
echo ""
