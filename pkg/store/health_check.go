package store

import (
	"log"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

// HealthCheckManager 节点健康检查与自动容灾熔断管理器
type HealthCheckManager struct {
	store        *MemoryStore
	unhealthyIPs map[string]time.Time // key: IP, value: 失败记录时间
	mu           sync.RWMutex
}

var globalHealthChecker *HealthCheckManager

// InitHealthChecker 初始化健康检查器
func (s *MemoryStore) StartHealthCheckCron() {
	globalHealthChecker = &HealthCheckManager{
		store:        s,
		unhealthyIPs: make(map[string]time.Time),
	}

	log.Println("[INFO] 正在启动 DNS 节点健康检查与宕机自动剔除服务 (Failover Engine)...")

	// 启动后延时 5 秒执行首次探测，避免启动时阻塞
	go func() {
		time.Sleep(5 * time.Second)
		globalHealthChecker.RunProbe()

		ticker := time.NewTicker(15 * time.Second)
		for range ticker.C {
			enabled := s.GetSetting("health_check_enabled", "true")
			if enabled != "false" {
				globalHealthChecker.RunProbe()
			}
		}
	}()
}

// IsIPHealthy 检查单个 IP 是否健康
func (s *MemoryStore) IsIPHealthy(ip string) bool {
	if globalHealthChecker == nil {
		return true
	}
	globalHealthChecker.mu.RLock()
	defer globalHealthChecker.mu.RUnlock()
	_, unhealthy := globalHealthChecker.unhealthyIPs[ip]
	return !unhealthy
}

// FilterHealthyIPs 过滤出健康的 IP 列表
func (s *MemoryStore) FilterHealthyIPs(ips []string) []string {
	if globalHealthChecker == nil || len(ips) == 0 {
		return ips
	}
	globalHealthChecker.mu.RLock()
	defer globalHealthChecker.mu.RUnlock()

	var healthy []string
	for _, ip := range ips {
		trimmed := strings.TrimSpace(ip)
		if trimmed == "" {
			continue
		}
		if _, unhealthy := globalHealthChecker.unhealthyIPs[trimmed]; !unhealthy {
			healthy = append(healthy, trimmed)
		}
	}
	return healthy
}

// GetUnhealthyIPList 获取当前所有离线故障 IP 列表
func (s *MemoryStore) GetUnhealthyIPList() map[string]int64 {
	res := make(map[string]int64)
	if globalHealthChecker == nil {
		return res
	}
	globalHealthChecker.mu.RLock()
	defer globalHealthChecker.mu.RUnlock()
	for ip, t := range globalHealthChecker.unhealthyIPs {
		res[ip] = t.Unix()
	}
	return res
}

// RunProbe 执行一轮全量 IP 健康探测
func (h *HealthCheckManager) RunProbe() {
	// 1. 获取所有需要探测的 IP 地址 (收集 A 和 AAAA 记录)
	h.store.mu.RLock()
	ipMap := make(map[string]bool)
	for _, dom := range h.store.Domains {
		for _, recs := range dom.Records {
			for _, rec := range recs {
				if rec.Type == "A" || rec.Type == "AAAA" {
					for _, val := range rec.Values {
						ip := strings.TrimSpace(val)
						if ip != "" {
							ipMap[ip] = true
						}
					}
				}
			}
		}
	}
	h.store.mu.RUnlock()

	if len(ipMap) == 0 {
		return
	}

	// 2. 读取配置的探测端口列表，默认 443, 80, 53143, 52183
	portsStr := h.store.GetSetting("health_check_ports", "443,80,53143,52183")
	ports := strings.Split(portsStr, ",")

	timeoutStr := h.store.GetSetting("health_check_timeout", "2")
	timeoutSec, err := strconv.Atoi(timeoutStr)
	if err != nil || timeoutSec < 1 {
		timeoutSec = 2
	}
	timeout := time.Duration(timeoutSec) * time.Second

	// 3. 并发探测每个 IP
	var wg sync.WaitGroup
	for ip := range ipMap {
		wg.Add(1)
		go func(targetIP string) {
			defer wg.Done()
			isAlive := probeIP(targetIP, ports, timeout)

			h.mu.Lock()
			defer h.mu.Unlock()

			_, wasUnhealthy := h.unhealthyIPs[targetIP]
			if isAlive {
				if wasUnhealthy {
					delete(h.unhealthyIPs, targetIP)
					log.Printf("[HEALTH-RECOVER] 🟢 节点 IP [%s] 探测恢复正常，已自动重新上线加入解析池！", targetIP)
				}
			} else {
				if !wasUnhealthy {
					h.unhealthyIPs[targetIP] = time.Now()
					log.Printf("[HEALTH-ALERT] 🔴 节点 IP [%s] 探测连接超时/不通，已自动从解析池剔除 (Failover触发)！", targetIP)
				}
			}
		}(ip)
	}
	wg.Wait()
}

// probeIP 对指定 IP 的多个端口进行 TCP 探测，只要任意一个端口连通即视为存活
func probeIP(ip string, ports []string, timeout time.Duration) bool {
	// 快速探测：遍历所有常见服务端口
	for _, portStr := range ports {
		portStr = strings.TrimSpace(portStr)
		if portStr == "" {
			continue
		}
		target := net.JoinHostPort(ip, portStr)
		conn, err := net.DialTimeout("tcp", target, timeout)
		if err == nil {
			conn.Close()
			return true
		}
	}

	// 重试机制：若首次全部失败，延时 500ms 重试一次主要端口，避免偶发网络抖动误判
	time.Sleep(500 * time.Millisecond)
	for _, portStr := range ports {
		portStr = strings.TrimSpace(portStr)
		if portStr == "" {
			continue
		}
		target := net.JoinHostPort(ip, portStr)
		conn, err := net.DialTimeout("tcp", target, timeout)
		if err == nil {
			conn.Close()
			return true
		}
	}

	return false
}
