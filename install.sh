#!/bin/bash
# ==============================================================================
# TriNet DNS - 三网智能解析系统一键部署脚本 (Linux 适用)
# 支持环境: Debian, Ubuntu, CentOS 及其他 systemd 系统
# ==============================================================================

# 默认 GitHub 仓库路径 (您可以运行脚本时通过传参覆盖，如 ./install.sh your_name/your_repo)
DEFAULT_REPO="nasstoki/trinet-dns"
GITHUB_REPO="${1:-$DEFAULT_REPO}"

INSTALL_DIR="/usr/local/bin"
CONF_DIR="/etc/trinet-dns"
SERVICE_FILE="/etc/systemd/system/trinet-dns.service"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}        TriNet DNS (三网智能解析系统) 一键安装工具       ${NC}"
echo -e "${BLUE}====================================================${NC}"

# 1. 权限检查
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}错误: 必须使用 root 权限运行此脚本！请使用 sudo su 切换后再运行。${NC}"
    exit 1
fi

# 2. 检查依赖
echo -e "正在检查系统依赖..."
for cmd in curl wget systemctl; do
    if ! command -v $cmd &> /dev/null; then
        echo -e "${YELLOW}警告: 未找到 $cmd，正在尝试自动安装...${NC}"
        if command -v apt-get &> /dev/null; then
            apt-get update && apt-get install -y $cmd
        elif command -v yum &> /dev/null; then
            yum install -y $cmd
        else
            echo -e "${RED}错误: 无法安装依赖项 $cmd，请手动安装后重试。${NC}"
            exit 1
        fi
    fi
done

# 3. 架构检测
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)
        BINARY_NAME="trinet-dns-linux-amd64"
        ;;
    aarch64|arm64)
        BINARY_NAME="trinet-dns-linux-arm64"
        ;;
    *)
        echo -e "${RED}错误: 暂不支持您的系统架构: $ARCH${NC}"
        exit 1
        ;;
esac
echo -e "✓ 系统架构检测成功: ${GREEN}$ARCH${NC}"

# 4. 获取最新 Release 版本号与下载地址
echo -e "正在连接 GitHub 获取最新版本信息 (仓库: $GITHUB_REPO)..."
LATEST_TAG=$(curl -s "https://api.github.com/repos/$GITHUB_REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_TAG" ]; then
    echo -e "${RED}错误: 无法获取最新版本信息，请确认仓库路径是否正确或是否存在已发布的 Release。${NC}"
    echo -e "${YELLOW}提示: 如果仓库是私有的或尚未推送过 tag (例如 v1.0.0)，会导致此步失败。${NC}"
    exit 1
fi
echo -e "✓ 获取到最新版本: ${GREEN}$LATEST_TAG${NC}"

DOWNLOAD_URL="https://github.com/$GITHUB_REPO/releases/download/$LATEST_TAG/$BINARY_NAME"

# 5. 创建配置文件夹并下载二进制文件
mkdir -p $CONF_DIR

echo -e "正在下载二进制主程序..."
wget -q --show-progress -O "$INSTALL_DIR/trinet-dns" "$DOWNLOAD_URL"
if [ $? -ne 0 ]; then
    echo -e "${RED}错误: 主程序下载失败，请检查网络或 $DOWNLOAD_URL${NC}"
    exit 1
fi
chmod +x "$INSTALL_DIR/trinet-dns"
echo -e "✓ 主程序安装成功: ${GREEN}$INSTALL_DIR/trinet-dns${NC}"

# 6. 下载三网 IP 自动更新脚本
echo -e "正在配置三网 IP 路由更新规则..."
cat << 'EOF' > "$CONF_DIR/update_geoip.sh"
#!/bin/bash
OUTPUT_FILE="/etc/trinet-dns/geoip_rules.txt"
TEMP_DIR="/tmp/trinet_geoip"
mkdir -p $TEMP_DIR
BASE_URL="https://cdn.jsdelivr.net/gh/gaoyifan/china-operator-ip@ip-lists"

echo "Downloading latest ISP IP ranges..."
curl -s -o "$TEMP_DIR/chinanet.txt" "$BASE_URL/chinanet.txt"
curl -s -o "$TEMP_DIR/unicom.txt" "$BASE_URL/unicom.txt"
curl -s -o "$TEMP_DIR/cmcc.txt" "$BASE_URL/cmcc.txt"

echo "# TriNet DNS Auto ISP Routing Rules" > $OUTPUT_FILE
echo "# Updated: $(date '+%Y-%m-%d %H:%M:%S')" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE

if [ -f "$TEMP_DIR/chinanet.txt" ]; then
    awk '{print $1 " ct"}' "$TEMP_DIR/chinanet.txt" >> $OUTPUT_FILE
fi
if [ -f "$TEMP_DIR/unicom.txt" ]; then
    awk '{print $1 " cu"}' "$TEMP_DIR/unicom.txt" >> $OUTPUT_FILE
fi
if [ -f "$TEMP_DIR/cmcc.txt" ]; then
    awk '{print $1 " cm"}' "$TEMP_DIR/cmcc.txt" >> $OUTPUT_FILE
fi
rm -rf $TEMP_DIR
echo "✓ ISP Rules updated at $OUTPUT_FILE"
EOF

chmod +x "$CONF_DIR/update_geoip.sh"
# 执行第一次数据拉取
cd $CONF_DIR && ./update_geoip.sh && cd - > /dev/null

# 7. 配置 Cron 每日凌晨 3:00 自动更新 IP 库
CRON_JOB="0 3 * * * $CONF_DIR/update_geoip.sh && systemctl restart trinet-dns"
(crontab -l 2>/dev/null | grep -Fv "$CONF_DIR/update_geoip.sh"; echo "$CRON_JOB") | crontab -

# 8. 写入 Systemd 服务
echo -e "正在配置 Systemd 系统守护服务..."
cat << EOF > $SERVICE_FILE
[Unit]
Description=TriNet DNS Authoritative Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$CONF_DIR
ExecStart=$INSTALL_DIR/trinet-dns -dns-addr :53 -web-addr :80 -data-path $CONF_DIR/trinet-records.json
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

# 9. 启动服务并运行自启
systemctl daemon-reload
systemctl enable trinet-dns
systemctl restart trinet-dns

# 10. 输出结果
echo -e "\n${GREEN}====================================================${NC}"
echo -e "${GREEN}      🎉 TriNet DNS (三网智能解析系统) 安装成功！        ${NC}"
echo -e "${GREEN}====================================================${NC}"
echo -e "🔹 启动状态: $(systemctl is-active trinet-dns)"
echo -e "🔹 主程序位置: ${BLUE}$INSTALL_DIR/trinet-dns${NC}"
echo -e "🔹 配置文件与路由表目录: ${BLUE}$CONF_DIR${NC}"
echo -e "🔹 本机 Web 管理控制台: ${GREEN}http://<您的服务器公网IP>${NC} (默认 80 端口)"
echo -e "🔹 自动更新: 已配置每日凌晨 3:00 自动拉取最新中国三网段并重载解析记录。"
echo -e "\n${YELLOW}查看服务运行日志: journalctl -u trinet-dns -f${NC}"
echo -e "${GREEN}====================================================${NC}"
