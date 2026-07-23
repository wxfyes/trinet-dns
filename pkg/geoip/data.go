package geoip

import (
	"bufio"
	"log"
	"os"
	"strings"
)

// SeedDefaultRoutes 填充初始化的演示三网网段
func (t *ISPRoutingMap) SeedDefaultRoutes() {
	// 电信 (CT) 段
	ctBlocks := []string{
		"218.85.0.0/16",
		"101.95.0.0/16",
		"222.186.0.0/16",
		"119.29.29.0/24", // 模拟 119.29.29.29
	}
	for _, cidr := range ctBlocks {
		t.InsertCIDR(cidr, "ct")
	}

	// 联通 (CU) 段
	cuBlocks := []string{
		"112.80.0.0/16",
		"210.22.0.0/16",
		"58.240.0.0/16",
		"114.114.114.0/24", // 模拟 114
	}
	for _, cidr := range cuBlocks {
		t.InsertCIDR(cidr, "cu")
	}

	// 移动 (CM) 段
	cmBlocks := []string{
		"112.5.0.0/16",
		"117.136.0.0/16",
		"223.5.5.0/24", // 模拟 223.5.5.5
	}
	for _, cidr := range cmBlocks {
		t.InsertCIDR(cidr, "cm")
	}

	log.Printf("[INFO] 默认三网 IP 路由树种子数据加载完成（CT: %d, CU: %d, CM: %d）", len(ctBlocks), len(cuBlocks), len(cmBlocks))
}

// LoadFromTextFile 从文本文件中批量加载 CIDR 段。格式：每一行 "1.1.1.0/24 isp" (以空格或逗号分隔)
func (t *ISPRoutingMap) LoadFromTextFile(filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	count := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// 兼容空格和逗号分隔
		line = strings.ReplaceAll(line, ",", " ")
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		cidr := parts[0]
		isp := strings.ToLower(parts[1])

		// 放宽强制校验，允许包含分省格式 (如 ct_gd)
		if len(isp) == 0 || len(isp) > 20 {
			continue
		}

		if err := t.InsertCIDR(cidr, isp); err == nil {
			count++
		}
	}

	log.Printf("[INFO] 从外部文件 %s 成功载入 %d 条三网路由规则", filePath, count)
	return scanner.Err()
}
