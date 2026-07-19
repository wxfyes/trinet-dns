#!/bin/bash
# ==============================================================================
# TriNet DNS - 三网智能解析系统一键管理脚本 (Linux 适用)
# 支持环境: Debian, Ubuntu, CentOS 及其他 systemd 系统
# ==============================================================================

# 默认 GitHub 仓库路径
DEFAULT_REPO="wxfyes/trinet-dns"
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

# 权限检查
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}错误: 必须使用 root 权限运行此脚本！请使用 sudo su 切换后再运行。${NC}"
    exit 1
fi

check_dependencies() {
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
}

detect_arch() {
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
}

install_trinet() {
    check_dependencies
    detect_arch

    echo -e "正在连接 GitHub 获取最新版本信息 (仓库: $GITHUB_REPO)..."
    LATEST_TAG=$(curl -s "https://api.github.com/repos/$GITHUB_REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

    if [ -z "$LATEST_TAG" ]; then
        echo -e "${RED}错误: 无法获取最新版本信息，请确认仓库路径是否正确或是否存在已发布的 Release。${NC}"
        echo -e "${YELLOW}提示: 如果仓库是私有的或尚未推送过 tag，会导致此步失败。${NC}"
        read -p "按回车返回主菜单..."
        show_menu
        return
    fi
    echo -e "✓ 获取到最新版本: ${GREEN}$LATEST_TAG${NC}"

    DOWNLOAD_URL="https://github.com/$GITHUB_REPO/releases/download/$LATEST_TAG/$BINARY_NAME"

    mkdir -p $CONF_DIR

    if systemctl is-active --quiet trinet-dns; then
        echo "正在停止运行中的 TriNet DNS 服务以进行升级..."
        systemctl stop trinet-dns
    fi

    echo -e "正在下载二进制主程序..."
    wget -q --show-progress -O "$INSTALL_DIR/trinet-dns" "$DOWNLOAD_URL"
    if [ $? -ne 0 ]; then
        echo -e "${RED}错误: 主程序下载失败，请检查网络或 $DOWNLOAD_URL${NC}"
        read -p "按回车返回主菜单..."
        show_menu
        return
    fi
    chmod +x "$INSTALL_DIR/trinet-dns"
    echo -e "✓ 主程序下载成功: ${GREEN}$INSTALL_DIR/trinet-dns${NC}"

    # 写入版本号文件供查询
    echo "$LATEST_TAG" > "$CONF_DIR/version"

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
    cd $CONF_DIR && ./update_geoip.sh && cd - > /dev/null

    CRON_JOB="0 3 * * * $CONF_DIR/update_geoip.sh && systemctl restart trinet-dns"
    (crontab -l 2>/dev/null | grep -Fv "$CONF_DIR/update_geoip.sh"; echo "$CRON_JOB") | crontab -

    echo -e "正在配置 Systemd 系统守护服务..."
    cat << EOF > $SERVICE_FILE
[Unit]
Description=TriNet DNS Authoritative Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$CONF_DIR
ExecStart=$INSTALL_DIR/trinet-dns -dns-addr :53 -web-addr :18080 -data-path $CONF_DIR/trinet-records.json
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable trinet-dns
    systemctl restart trinet-dns

    echo -e "\n${GREEN}====================================================${NC}"
    echo -e "${GREEN}      🎉 TriNet DNS (三网智能解析系统) 安装成功！        ${NC}"
    echo -e "${GREEN}====================================================${NC}"
    echo -e "🔹 启动状态: $(systemctl is-active trinet-dns)"
    echo -e "🔹 主程序位置: ${BLUE}$INSTALL_DIR/trinet-dns${NC}"
    echo -e "🔹 配置文件与路由表目录: ${BLUE}$CONF_DIR${NC}"
    echo -e "🔹 本机 Web 管理控制台: ${GREEN}http://<您的服务器公网IP>:18080${NC} (默认 18080 端口)"
    echo -e "🔹 自动更新: 已配置每日凌晨 3:00 自动拉取最新中国三网段并重载解析记录。"
    echo -e "${GREEN}====================================================${NC}"
    read -p "按回车返回主菜单..."
    show_menu
}

uninstall_trinet() {
    read -p "确定要完全卸载 TriNet DNS 吗？所有配置和解析数据都将被删除！[y/N]: " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        echo "正在卸载..."
        systemctl stop trinet-dns 2>/dev/null
        systemctl disable trinet-dns 2>/dev/null
        rm -f $SERVICE_FILE
        systemctl daemon-reload
        rm -f "$INSTALL_DIR/trinet-dns"
        rm -rf $CONF_DIR
        (crontab -l 2>/dev/null | grep -Fv "$CONF_DIR/update_geoip.sh") | crontab -
        echo -e "${GREEN}✓ TriNet DNS 已从您的系统中完全卸载清理。${NC}"
    else
        echo "已取消卸载操作。"
    fi
    sleep 2
    show_menu
}

start_service() {
    if [ ! -f "$INSTALL_DIR/trinet-dns" ]; then
        echo -e "${RED}错误: 主程序尚未安装！请先选择安装服务。${NC}"
        sleep 2
        show_menu
        return
    fi
    systemctl start trinet-dns
    echo -e "${GREEN}✓ DNS 服务已启动。${NC}"
    sleep 2
    show_menu
}

stop_service() {
    systemctl stop trinet-dns
    echo -e "${GREEN}✓ DNS 服务已停止。${NC}"
    sleep 2
    show_menu
}

restart_service() {
    systemctl restart trinet-dns
    echo -e "${GREEN}✓ DNS 服务已重新启动。${NC}"
    sleep 2
    show_menu
}

show_status() {
    echo -e "\n${BLUE}--- TriNet DNS 详细运行状态 ---${NC}"
    systemctl status trinet-dns --no-pager
    echo -e "${BLUE}--------------------------------${NC}"
    read -p "按回车返回主菜单..."
    show_menu
}

show_logs() {
    echo -e "\n${BLUE}正在查看实时解析日志（按 Ctrl+C 退出）...${NC}"
    journalctl -u trinet-dns -f
    show_menu
}

show_menu() {
    clear
    echo -e "${BLUE}====================================================${NC}"
    echo -e "${BLUE}        TriNet DNS (三网智能解析系统) 一键管理箱       ${NC}"
    echo -e "${BLUE}====================================================${NC}"
    echo -e "当前版本: ${GREEN}$(cat $CONF_DIR/version 2>/dev/null || echo "未安装/未知")${NC}"
    echo -e "服务状态: ${GREEN}$(systemctl is-active trinet-dns 2>/dev/null || echo "未运行")${NC}"
    echo -e "${BLUE}----------------------------------------------------${NC}"
    echo -e " 1. ${GREEN}安装 / 更新${NC} TriNet DNS"
    echo -e " 2. ${RED}完全卸载${NC} TriNet DNS"
    echo -e " 3. 启动 DNS 服务"
    echo -e " 4. 停止 DNS 服务"
    echo -e " 5. 重启 DNS 服务"
    echo -e " 6. 查看服务运行状态"
    echo -e " 7. 查看实时解析日志"
    echo -e " 0. 退出面板"
    echo -e "${BLUE}====================================================${NC}"
    read -p "请输入选项数字 [0-7]: " num
    case "$num" in
        1)
            install_trinet
            ;;
        2)
            uninstall_trinet
            ;;
        3)
            start_service
            ;;
        4)
            stop_service
            ;;
        5)
            restart_service
            ;;
        6)
            show_status
            ;;
        7)
            show_logs
            ;;
        0)
            exit 0
            ;;
        *)
            echo -e "${RED}输入错误，请输入有效选项数字！${NC}"
            sleep 1
            show_menu
            ;;
    esac
}

# 检测是否通过管道 (curl | bash) 运行，如果是则重新绑定 stdin 到终端
if [ ! -t 0 ]; then
    # stdin 不是终端，尝试重新绑定
    if [ -e /dev/tty ]; then
        exec < /dev/tty
    else
        echo -e "${RED}错误: 请使用以下方式运行脚本（不要用管道）:${NC}"
        echo -e "${YELLOW}bash <(curl -fsSL https://raw.githubusercontent.com/wxfyes/trinet-dns/main/install.sh)${NC}"
        exit 1
    fi
fi

# 首次执行直接拉起主菜单
show_menu
