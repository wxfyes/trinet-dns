package main

import (
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"trinet-dns/pkg/dns"
	"trinet-dns/pkg/geoip"
	"trinet-dns/pkg/store"
	"trinet-dns/pkg/web"
)

func main() {
	// 命令行参数定义
	dnsAddr := flag.String("dns-addr", ":53", "DNS 服务监听地址 (UDP)")
	webAddr := flag.String("web-addr", ":80", "Web 后台/API 服务监听地址")
	dataPath := flag.String("data-path", "trinet-records.json", "解析数据持久化 JSON 文件路径")

	// Web 后台用户名与密码
	webUser := flag.String("web-user", "admin", "Web 管理面板登录用户名")
	webPass := flag.String("web-pass", "admin123", "Web 管理面板登录密码")
	nsNodes := flag.String("ns-nodes", "ns1.cngoodok.org,ns2.cngoodok.org", "当前集群的 NS 解析节点列表 (以逗号分隔)")
	openReg := flag.Bool("open-registration", false, "是否启用多用户注册与隔离模式（开放注册功能）")

	// 节点同步模式参数
	syncMode := flag.Bool("sync-mode", false, "启用节点同步模式（仅作为解析节点，从控制端 API 同步记录）")
	syncURL := flag.String("sync-url", "", "控制端 API 数据同步地址 (如 https://trinet-api.workers.dev/api/records)")
	syncToken := flag.String("sync-token", "", "数据同步认证 Token")
	syncInterval := flag.Duration("sync-interval", 15*time.Second, "数据同步拉取时间间隔")

	flag.Parse()

	// 支持环境变量覆盖命令行参数，便于容器/Systemd部署
	if envUser := os.Getenv("TRINET_WEB_USER"); envUser != "" {
		*webUser = envUser
	}
	if envPass := os.Getenv("TRINET_WEB_PASS"); envPass != "" {
		*webPass = envPass
	}
	if envOpenReg := os.Getenv("TRINET_OPEN_REGISTRATION"); envOpenReg == "true" {
		*openReg = true
	}

	log.Println("[SYSTEM] TriNet DNS (三网智能解析) 系统正在初始化...")

	// 1. 初始化 IP 路由匹配树并加载内置种子数据
	routeMap := geoip.NewISPRoutingMap()
	routeMap.SeedDefaultRoutes()

	// 如果有外部运营商段文件，尝试加载
	if _, err := os.Stat("geoip_rules.txt"); err == nil {
		routeMap.LoadFromTextFile("geoip_rules.txt")
	}

	// 2. 初始化数据存储
	var recordStore *store.MemoryStore
	if *syncMode {
		log.Println("[SYSTEM] 运行模式: 节点同步模式 (Agent Mode)")
		if *syncURL == "" {
			log.Fatalf("[FATAL] 同步模式下 -sync-url 参数不能为空")
		}
		recordStore = store.NewMemoryStore("")
	} else {
		log.Println("[SYSTEM] 运行模式: 独立服务器模式 (Standalone Mode)")
		recordStore = store.NewMemoryStore(*dataPath)
		if u, p := recordStore.GetCredentials(); u == "" || p == "" {
			recordStore.SetCredentials(*webUser, *webPass)
		}
		recordStore.StartAutoRenewCron()
	}

	// 3. 通用解析日志通道，用于实时日志流动
	logChan := make(chan string, 100)

	// 4. 启动 DNS 解析守护进程
	dnsServer := dns.NewDNSServer(*dnsAddr, recordStore, routeMap, logChan)
	dnsServer.Start()

	// 5. 启动控制后台或数据同步协程
	if *syncMode {
		go startSyncAgent(recordStore, *syncURL, *syncToken, *syncInterval)
	} else {
		u, p := recordStore.GetCredentials()
		webServer := web.NewWebServer(*webAddr, recordStore, logChan, u, p, *syncToken, *nsNodes, *openReg)
		webServer.Start()
	}

	// 监听系统信号优雅退出
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("[SYSTEM] 正在关闭 DNS 引擎...")
	dnsServer.Stop()
	log.Println("[SYSTEM] TriNet DNS 安全退出。")
}

// startSyncAgent 从云端/主控拉取最新数据
func startSyncAgent(s *store.MemoryStore, url string, token string, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	httpClient := &http.Client{Timeout: 10 * time.Second}

	syncFunc := func() {
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			log.Printf("[SYNC ERROR] 构造同步请求失败: %s", err.Error())
			return
		}

		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}

		resp, err := httpClient.Do(req)
		if err != nil {
			log.Printf("[SYNC ERROR] 无法连接到控制端 API: %s", err.Error())
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			log.Printf("[SYNC ERROR] 同步接口返回异常状态码: %d", resp.StatusCode)
			return
		}

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("[SYNC ERROR] 读取同步报文失败: %s", err.Error())
			return
		}

		var remoteStore struct {
			Domains map[string]*store.DomainRecords `json:"domains"`
		}

		if err := json.Unmarshal(body, &remoteStore); err != nil {
			log.Printf("[SYNC ERROR] 解析同步 JSON 数据失败: %s", err.Error())
			return
		}

		s.LoadDataFromMap(remoteStore.Domains)
		log.Printf("[SYNC] 成功同步解析记录，当前托管主域名数: %d", len(remoteStore.Domains))
	}

	syncFunc()

	for range ticker.C {
		syncFunc()
	}
}
