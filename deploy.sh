#!/bin/bash
# ============================================
# 知纲项目一键部署脚本
# 用法: ./deploy.sh [服务器IP]
# 示例: ./deploy.sh 123.45.67.89
# ============================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 服务器配置
SERVER_IP="${1:-}"
SERVER_USER="root"
REMOTE_PATH="/var/www/zhigang"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  知纲项目部署脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查服务器 IP
if [ -z "$SERVER_IP" ]; then
    echo -e "${YELLOW}⚠️  未指定服务器 IP${NC}"
    echo -e "用法: ./deploy.sh <服务器公网IP>"
    echo -e "示例: ./deploy.sh 123.45.67.89"
    echo ""
    read -p "请输入服务器公网 IP: " SERVER_IP
    if [ -z "$SERVER_IP" ]; then
        echo -e "${RED}❌ 服务器 IP 不能为空${NC}"
        exit 1
    fi
fi

echo -e "${BLUE}📡 目标服务器: ${SERVER_IP}${NC}"
echo -e "${BLUE}📂 远程目录: ${REMOTE_PATH}${NC}"
echo ""

# 步骤 1: 构建项目
echo -e "${GREEN}[1/3] 🔨 正在构建项目...${NC}"
cd "$PROJECT_DIR"
pnpm build
echo -e "${GREEN}✅ 构建完成${NC}"
echo ""

# 步骤 2: 验证构建产物
echo -e "${GREEN}[2/3] 📦 检查构建产物...${NC}"
if [ ! -d "dist" ]; then
    echo -e "${RED}❌ dist 目录不存在，构建失败${NC}"
    exit 1
fi

if [ ! -f "dist/index.html" ]; then
    echo -e "${RED}❌ index.html 不存在，构建失败${NC}"
    exit 1
fi

DIST_SIZE=$(du -sh dist | cut -f1)
FILE_COUNT=$(find dist -type f | wc -l)
echo -e "   dist 目录大小: ${DIST_SIZE}"
echo -e "   文件数量: ${FILE_COUNT}"
echo -e "${GREEN}✅ 构建产物验证通过${NC}"
echo ""

# 步骤 3: 上传到服务器
echo -e "${GREEN}[3/3] 🚀 正在上传到服务器...${NC}"
echo -e "   使用 rsync 增量上传，只传输变化的文件"
echo ""

rsync -avz --delete \
    --exclude='*.map' \
    dist/ \
    ${SERVER_USER}@${SERVER_IP}:${REMOTE_PATH}/

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🎉 部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "🌐 访问地址: http://${SERVER_IP}"
echo ""
echo -e "${YELLOW}💡 提示:${NC}"
echo -e "   1. 如果页面没有更新，请按 Ctrl+Shift+R 强制刷新"
echo -e "   2. 如配置了 HTTPS 和域名，请使用 https 访问"
echo -e "   3. 查看 Nginx 日志: ssh ${SERVER_USER}@${SERVER_IP} 'tail -f /var/log/nginx/error.log'"
echo ""
