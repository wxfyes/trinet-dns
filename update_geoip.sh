#!/bin/bash
# ==============================================================================
# TianQue DNS - 开源三网 IP 库自动更新脚本 (Linux 适用)
# ==============================================================================

OUTPUT_FILE="geoip_rules.txt"
TEMP_DIR="/tmp/tianque_geoip"
mkdir -p $TEMP_DIR

# GitHub 镜像源 (使用 jsdelivr 加速拉取，避免国内 VPS 连接 GitHub 慢的问题)
BASE_URL="https://cdn.jsdelivr.net/gh/gaoyifan/china-operator-ip@ip-lists"

echo "正在从开源项目 gaoyifan/china-operator-ip 下载最新三网 IP 段..."

# 1. 下载各运营商 IP 段
curl -s -o "$TEMP_DIR/chinanet.txt" "$BASE_URL/chinanet.txt"
curl -s -o "$TEMP_DIR/unicom.txt" "$BASE_URL/unicom.txt"
curl -s -o "$TEMP_DIR/cmcc.txt" "$BASE_URL/cmcc.txt"

# 2. 格式化并合并到 geoip_rules.txt
echo "# TianQue DNS 自动生成的三网 IP 路由规则" > $OUTPUT_FILE
echo "# 更新时间: $(date '+%Y-%m-%d %H:%M:%S')" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE

if [ -f "$TEMP_DIR/chinanet.txt" ]; then
    awk '{print $1 " ct"}' "$TEMP_DIR/chinanet.txt" >> $OUTPUT_FILE
    echo "✓ 电信 (Chinanet) 规则处理完成"
fi

if [ -f "$TEMP_DIR/unicom.txt" ]; then
    awk '{print $1 " cu"}' "$TEMP_DIR/unicom.txt" >> $OUTPUT_FILE
    echo "✓ 联通 (Unicom) 规则处理完成"
fi

if [ -f "$TEMP_DIR/cmcc.txt" ]; then
    awk '{print $1 " cm"}' "$TEMP_DIR/cmcc.txt" >> $OUTPUT_FILE
    echo "✓ 移动 (CMCC) 规则处理完成"
fi

# 3. 清理临时目录
rm -rf $TEMP_DIR

TOTAL_LINES=$(wc -l < $OUTPUT_FILE)
echo "✓ 成功合并生成 $OUTPUT_FILE，共计 $((TOTAL_LINES - 3)) 条三网路由匹配规则！"
echo "请重启 TianQue DNS 以应用最新路由表。"
