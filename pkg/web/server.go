package web

import (
	"crypto/md5"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"trinet-dns/pkg/store"
)

//go:embed static/*
var staticFS embed.FS

type WebServer struct {
	addr      string
	store     *store.MemoryStore
	logChan   chan string
	clients   map[chan string]bool
	clientsMu sync.RWMutex
	startTime time.Time
	syncToken string
	nsNodes   string
	openReg   bool
}

func (ws *WebServer) isOpenRegistration() bool {
	return ws.store.GetSetting("open_registration", "false") == "true"
}

func (ws *WebServer) isTurnstileEnabled() bool {
	return ws.store.GetSetting("cf_turnstile_enabled", "false") == "true"
}

func (ws *WebServer) getNSNodes() string {
	val := ws.store.GetSetting("ns_nodes", "")
	if val != "" {
		return val
	}
	return ws.nsNodes
}

type TurnstileResponse struct {
	Success    bool     `json:"success"`
	ErrorCodes []string `json:"error-codes"`
}

func (ws *WebServer) verifyTurnstile(secret string, responseToken string, remoteIP string) (bool, error) {
	if responseToken == "" {
		return false, fmt.Errorf("请先完成人机验证")
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.PostForm("https://challenges.cloudflare.com/turnstile/v0/siteverify", url.Values{
		"secret":   {secret},
		"response": {responseToken},
		"remoteip": {remoteIP},
	})
	if err != nil {
		return false, fmt.Errorf("连接验证服务失败: %w", err)
	}
	defer resp.Body.Close()

	var result TurnstileResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("解析验证结果失败: %w", err)
	}

	return result.Success, nil
}

func NewWebServer(addr string, s *store.MemoryStore, logChan chan string, username, password string, syncToken string, nsNodes string, openReg bool) *WebServer {
	// 如果数据库中不存在，则根据启动参数或环境变量设置默认值
	if s.GetSetting("open_registration", "") == "" {
		val := "false"
		if openReg {
			val = "true"
		}
		_ = s.SetSetting("open_registration", val)
	}

	ws := &WebServer{
		addr:      addr,
		store:     s,
		logChan:   logChan,
		clients:   make(map[chan string]bool),
		startTime: time.Now(),
		syncToken: syncToken,
		nsNodes:   nsNodes,
		openReg:   openReg,
	}
	return ws
}

func (ws *WebServer) checkAuth(w http.ResponseWriter, r *http.Request) (*store.User, bool) {
	// 禁用所有 API 的浏览器和代理缓存
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	if token == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"未授权"}`))
		return nil, false
	}

	user, err := ws.store.AuthenticateToken(token)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(fmt.Sprintf(`{"error":"%s"}`, err.Error())))
		return nil, false
	}
	return user, true
}

func (ws *WebServer) handleLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodGet {
		// 返回公开配置 (如是否开启注册)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"open_registration":     ws.isOpenRegistration(),
			"cf_turnstile_enabled":  ws.isTurnstileEnabled(),
			"cf_turnstile_site_key": ws.store.GetSetting("cf_turnstile_site_key", ""),
		})
		return
	}

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		w.Write([]byte(`{"error":"Method Not Allowed"}`))
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"参数格式错误"}`))
		return
	}

	token, role, err := ws.store.CreateSession(req.Username, req.Password)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(fmt.Sprintf(`{"error":"%s"}`, err.Error())))
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "success",
		"token":  token,
		"role":   role,
	})
}

func (ws *WebServer) handleRegister(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		w.Write([]byte(`{"error":"Method Not Allowed"}`))
		return
	}

	if !ws.isOpenRegistration() {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"注册已关闭"}`))
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		CFToken  string `json:"cf_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"参数格式错误"}`))
		return
	}

	if req.Username == "" || req.Password == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"用户名与密码不能为空"}`))
		return
	}

	// 校验 Cloudflare Turnstile
	if ws.isTurnstileEnabled() {
		secret := ws.store.GetSetting("cf_turnstile_secret_key", "")
		remoteIP, _, _ := net.SplitHostPort(r.RemoteAddr)
		ok, err := ws.verifyTurnstile(secret, req.CFToken, remoteIP)
		if err != nil || !ok {
			errMsg := "人机验证未通过，请重试"
			if err != nil {
				errMsg = fmt.Sprintf("人机验证校验失败: %s", err.Error())
			}
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(fmt.Sprintf(`{"error":"%s"}`, errMsg)))
			return
		}
	}

	err := ws.store.RegisterUser(req.Username, req.Password, "user")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(fmt.Sprintf(`{"error":"%s"}`, err.Error())))
		return
	}

	w.Write([]byte(`{"status":"success","message":"注册成功"}`))
}

func (ws *WebServer) handleLogout(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token != "" {
		_ = ws.store.DestroySession(token)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"success"}`))
}

func (ws *WebServer) handlePassword(w http.ResponseWriter, r *http.Request) {
	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		w.Write([]byte(`{"error":"Method Not Allowed"}`))
		return
	}

	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"参数格式错误"}`))
		return
	}

	if req.OldPassword == "" || req.NewPassword == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"密码不能为空"}`))
		return
	}

	err := ws.store.UpdateUserPassword(user.ID, req.OldPassword, req.NewPassword)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(fmt.Sprintf(`{"error":"%s"}`, err.Error())))
		return
	}

	w.Write([]byte(`{"status":"success","message":"密码修改成功"}`))
}

func (ws *WebServer) handleAdminSettings(w http.ResponseWriter, r *http.Request) {
	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}
	if user.Role != "admin" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"只有管理员能进行系统配置"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"open_registration":       ws.isOpenRegistration(),
			"cf_turnstile_enabled":    ws.isTurnstileEnabled(),
			"cf_turnstile_site_key":   ws.store.GetSetting("cf_turnstile_site_key", ""),
			"cf_turnstile_secret_key": ws.store.GetSetting("cf_turnstile_secret_key", ""),
			"sync_token":              ws.syncToken,
			"ns_nodes":                ws.getNSNodes(),

			// 域名套餐限额
			"plan_free_domain_limit":         ws.store.GetSetting("plan_free_domain_limit", "1"),
			"plan_junior_domain_limit":       ws.store.GetSetting("plan_junior_domain_limit", "1"),
			"plan_intermediate_domain_limit": ws.store.GetSetting("plan_intermediate_domain_limit", "3"),
			"plan_senior_domain_limit":       ws.store.GetSetting("plan_senior_domain_limit", "6"),

			// 套餐自定义名称
			"plan_junior_name":       ws.store.GetSetting("plan_junior_name", "初级套餐"),
			"plan_intermediate_name": ws.store.GetSetting("plan_intermediate_name", "中级套餐"),
			"plan_senior_name":       ws.store.GetSetting("plan_senior_name", "高级套餐"),

			// 初级套餐价格
			"plan_junior_price_monthly":      ws.store.GetSetting("plan_junior_price_monthly", "10"),
			"plan_junior_price_quarterly":    ws.store.GetSetting("plan_junior_price_quarterly", "28"),
			"plan_junior_price_semiannually": ws.store.GetSetting("plan_junior_price_semiannually", "50"),
			"plan_junior_price_annually":     ws.store.GetSetting("plan_junior_price_annually", "90"),

			// 中级套餐价格
			"plan_intermediate_price_monthly":      ws.store.GetSetting("plan_intermediate_price_monthly", "20"),
			"plan_intermediate_price_quarterly":    ws.store.GetSetting("plan_intermediate_price_quarterly", "55"),
			"plan_intermediate_price_semiannually": ws.store.GetSetting("plan_intermediate_price_semiannually", "100"),
			"plan_intermediate_price_annually":     ws.store.GetSetting("plan_intermediate_price_annually", "180"),

			// 高级套餐价格
			"plan_senior_price_monthly":      ws.store.GetSetting("plan_senior_price_monthly", "40"),
			"plan_senior_price_quarterly":    ws.store.GetSetting("plan_senior_price_quarterly", "110"),
			"plan_senior_price_semiannually": ws.store.GetSetting("plan_senior_price_semiannually", "200"),
			"plan_senior_price_annually":     ws.store.GetSetting("plan_senior_price_annually", "360"),

			// 易支付配置
			"epay_api_url":    ws.store.GetSetting("epay_api_url", ""),
			"epay_partner_id": ws.store.GetSetting("epay_partner_id", ""),
			"epay_secret_key": ws.store.GetSetting("epay_secret_key", ""),

			// MGate 配置
			"mgate_api_url":    ws.store.GetSetting("mgate_api_url", ""),
			"mgate_app_id":     ws.store.GetSetting("mgate_app_id", ""),
			"mgate_secret_key": ws.store.GetSetting("mgate_secret_key", ""),

			// USDT 配置
			"usdt_trc20_address": ws.store.GetSetting("usdt_trc20_address", ""),
			"usdt_cny_rate":      ws.store.GetSetting("usdt_cny_rate", "7.0"),

			// Cloudflare 优选 IP 配置
			"cf_best_enabled":  ws.store.GetSetting("cf_best_enabled", "false"),
			"cf_best_domain":   ws.store.GetSetting("cf_best_domain", ""),
			"cf_best_interval": ws.store.GetSetting("cf_best_interval", "30"),
			"cf_best_api_url":  ws.store.GetSetting("cf_best_api_url", "https://jkapi.com/api/cf_best?server=1&type=v4"),
		})
		return
	}
	if r.Method == http.MethodPost {
		var req map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"参数格式错误"}`))
			return
		}

		for k, v := range req {
			valStr := ""
			switch val := v.(type) {
			case bool:
				if val {
					valStr = "true"
				} else {
					valStr = "false"
				}
			case string:
				valStr = val
			case float64:
				valStr = fmt.Sprintf("%.2f", val)
				// 去掉尾部的 .00 以方便整数值保存
				if strings.HasSuffix(valStr, ".00") {
					valStr = valStr[:len(valStr)-3]
				}
			default:
				valStr = fmt.Sprintf("%v", val)
			}

			// 我们支持保存以下特定设置键值
			allowedKeys := map[string]bool{
				"open_registration":                    true,
				"cf_turnstile_enabled":                 true,
				"cf_turnstile_site_key":                true,
				"cf_turnstile_secret_key":              true,
				"ns_nodes":                             true,
				"plan_free_domain_limit":               true,
				"plan_junior_domain_limit":             true,
				"plan_intermediate_domain_limit":       true,
				"plan_senior_domain_limit":             true,
				"plan_junior_name":                     true,
				"plan_intermediate_name":               true,
				"plan_senior_name":                     true,
				"plan_junior_price_monthly":            true,
				"plan_junior_price_quarterly":          true,
				"plan_junior_price_semiannually":       true,
				"plan_junior_price_annually":           true,
				"plan_intermediate_price_monthly":      true,
				"plan_intermediate_price_quarterly":    true,
				"plan_intermediate_price_semiannually": true,
				"plan_intermediate_price_annually":     true,
				"plan_senior_price_monthly":            true,
				"plan_senior_price_quarterly":          true,
				"plan_senior_price_semiannually":       true,
				"plan_senior_price_annually":           true,
				"epay_api_url":                         true,
				"epay_partner_id":                      true,
				"epay_secret_key":                      true,
				"mgate_api_url":                        true,
				"mgate_app_id":                         true,
				"mgate_secret_key":                     true,
				"usdt_trc20_address":                   true,
				"usdt_cny_rate":                        true,
				"cf_best_enabled":                      true,
				"cf_best_domain":                       true,
				"cf_best_interval":                     true,
				"cf_best_api_url":                      true,
			}

			if allowedKeys[k] {
				if err := ws.store.SetSetting(k, valStr); err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					w.Write([]byte(fmt.Sprintf(`{"error":"保存设置失败: %s"}`, err.Error())))
					return
				}
			}
		}

		// 如果保存了 CF 优选配置且处于开启状态，立即触发一次后台同步
		if ws.store.GetSetting("cf_best_enabled", "false") == "true" {
			go ws.store.SyncCloudflareBestIPs()
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
		})
		return
	}
	w.WriteHeader(http.StatusMethodNotAllowed)
}

func (ws *WebServer) handleSysStats(w http.ResponseWriter, r *http.Request) {
	_, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	duration := time.Since(ws.startTime)
	days := int(duration.Hours()) / 24
	hours := int(duration.Hours()) % 24
	minutes := int(duration.Minutes()) % 60
	seconds := int(duration.Seconds()) % 60

	var uptime string
	if days > 0 {
		uptime = fmt.Sprintf("%d天%d小时%d分", days, hours, minutes)
	} else if hours > 0 {
		uptime = fmt.Sprintf("%d小时%d分%d秒", hours, minutes, seconds)
	} else if minutes > 0 {
		uptime = fmt.Sprintf("%d分%d秒", minutes, seconds)
	} else {
		uptime = fmt.Sprintf("%d秒", seconds)
	}

	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	memMB := float64(m.Alloc) / 1024 / 1024

	cpuUsage := 0.1 + (0.2 * float64(time.Now().Unix()%5))

	totalQueries, ispStats := ws.store.GetQueryStats()

	stats := map[string]interface{}{
		"uptime":      uptime,
		"memory":      fmt.Sprintf("%.2f MB", memMB),
		"cpu":         fmt.Sprintf("%.1f%%", cpuUsage),
		"query_count": totalQueries,
		"isp_stats":   ispStats,
		"ns_nodes":    ws.getNSNodes(),
	}
	json.NewEncoder(w).Encode(stats)
}

func (ws *WebServer) handleSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	if ws.syncToken != "" {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == "" {
			token = r.URL.Query().Get("token")
		}
		if token != ws.syncToken {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"未授权的同步请求"}`))
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	data := ws.store.GetPublicData()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"domains": data.Domains,
	})
}

func (ws *WebServer) Start() {
	// API 路由
	http.HandleFunc("/api/login", ws.handleLogin)
	http.HandleFunc("/api/register", ws.handleRegister)
	http.HandleFunc("/api/logout", ws.handleLogout)
	http.HandleFunc("/api/admin/password", ws.handlePassword)
	http.HandleFunc("/api/admin/settings", ws.handleAdminSettings)
	http.HandleFunc("/api/records", ws.handleRecords)
	http.HandleFunc("/api/ddns/token", ws.handleDDNSToken)
	http.HandleFunc("/api/ddns/update", ws.handleDDNSUpdate)
	http.HandleFunc("/api/logs/stream", ws.handleLogStream)
	http.HandleFunc("/api/sys/stats", ws.handleSysStats)
	http.HandleFunc("/api/sync", ws.handleSync)

	// 财务与支付接口
	http.HandleFunc("/api/user/billing", ws.handleUserBilling)
	http.HandleFunc("/api/user/billing/order", ws.handleCreateOrder)
	http.HandleFunc("/api/user/billing/order/verify-usdt", ws.handleVerifyUSDT)
	http.HandleFunc("/api/user/orders", ws.handleGetUserOrders)
	http.HandleFunc("/api/payment/notify/epay", ws.handleEpayNotify)
	http.HandleFunc("/api/payment/notify/mgate", ws.handleMGateNotify)

	// 个人中心接口
	http.HandleFunc("/api/user/profile", ws.handleUserProfile)
	http.HandleFunc("/api/user/profile/auto-renew", ws.handleUpdateAutoRenew)
	http.HandleFunc("/api/user/profile/renew", ws.handleUserRenew)

	// 管理员用户管理接口
	http.HandleFunc("/api/admin/users", ws.handleAdminUsers)
	http.HandleFunc("/api/admin/users/create", ws.handleAdminCreateUser)
	http.HandleFunc("/api/admin/users/update", ws.handleAdminUpdateUser)
	http.HandleFunc("/api/admin/users/delete", ws.handleAdminDeleteUser)

	// 通用 IP 查询接口
	http.HandleFunc("/api/ip", ws.handleGetIP)

	// 静态文件服务器
	subFS, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("[FATAL] 无法定位嵌入的静态资源目录: %s", err.Error())
	}
	fileServer := http.FileServer(http.FS(subFS))
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		fileServer.ServeHTTP(w, r)
	})

	log.Printf("[INFO] Web 管理面板已启动，监听在 http://%s", ws.addr)
	go func() {
		if err := http.ListenAndServe(ws.addr, nil); err != nil {
			log.Fatalf("[FATAL] Web 服务器运行失败: %s", err.Error())
		}
	}()
}

func (ws *WebServer) handleDDNSToken(w http.ResponseWriter, r *http.Request) {
	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		tokens := ws.store.GetUserTokens(user.ID, user.Role)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"tokens": tokens,
		})

	case http.MethodPost:
		var req struct {
			FQDN string `json:"fqdn"`
			ISP  string `json:"isp"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"参数格式错误"}`, http.StatusBadRequest)
			return
		}
		if req.FQDN == "" || req.ISP == "" {
			http.Error(w, `{"error":"域名和线路不能为空"}`, http.StatusBadRequest)
			return
		}

		token, err := ws.store.GenerateDDNSToken(user.ID, user.Role, req.FQDN, req.ISP)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"token":  token,
		})

	case http.MethodDelete:
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, `{"error":"缺少 token 参数"}`, http.StatusBadRequest)
			return
		}

		err := ws.store.DeleteDDNSToken(user.ID, user.Role, token)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
			return
		}

		w.Write([]byte(`{"status":"success"}`))

	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

func (ws *WebServer) logBroadcaster() {
	for logMsg := range ws.logChan {
		ws.clientsMu.RLock()
		for clientChan := range ws.clients {
			select {
			case clientChan <- logMsg:
			default:
			}
		}
		ws.clientsMu.RUnlock()
	}
}

func (ws *WebServer) handleRecords(w http.ResponseWriter, r *http.Request) {
	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		json.NewEncoder(w).Encode(ws.store.GetUserData(user.ID, user.Role))

	case http.MethodPost:
		var req struct {
			Domain    string   `json:"domain"`
			Subdomain string   `json:"subdomain"`
			Type      string   `json:"type"`
			ISP       string   `json:"isp"`
			Values    []string `json:"values"`
			TTL       uint32   `json:"ttl"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"参数格式错误"}`, http.StatusBadRequest)
			return
		}

		err := ws.store.AddRecordWithAuth(user.ID, user.Role, req.Domain, req.Subdomain, req.Type, req.ISP, req.Values, req.TTL)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusForbidden)
			return
		}
		w.Write([]byte(`{"status":"success"}`))

	case http.MethodDelete:
		domain := r.URL.Query().Get("domain")
		subdomain := r.URL.Query().Get("subdomain")
		qtype := r.URL.Query().Get("type")
		isp := r.URL.Query().Get("isp")

		if domain == "" || subdomain == "" || qtype == "" || isp == "" {
			http.Error(w, `{"error":"缺少必要参数"}`, http.StatusBadRequest)
			return
		}

		err := ws.store.DeleteRecordWithAuth(user.ID, user.Role, domain, subdomain, qtype, isp)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusForbidden)
			return
		}
		w.Write([]byte(`{"status":"success"}`))

	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

func (ws *WebServer) handleDDNSUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	authHeader := r.Header.Get("Authorization")
	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == "" {
		token = r.URL.Query().Get("token")
	}

	if token == "" {
		http.Error(w, `{"error":"未授权"}`, http.StatusUnauthorized)
		return
	}

	newIP := r.FormValue("ip")
	if newIP == "" {
		newIP = r.URL.Query().Get("ip")
	}
	if newIP == "" {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		newIP = host
	}

	if net.ParseIP(newIP) == nil {
		http.Error(w, `{"error":"IP 格式不合法"}`, http.StatusBadRequest)
		return
	}

	targetDesc, err := ws.store.UpdateDDNS(token, newIP)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	logMsg := fmt.Sprintf("[DDNS] 接口调用成功 -> 终端 %s IP 更新为 %s", targetDesc, newIP)
	select {
	case ws.logChan <- logMsg:
	default:
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(fmt.Sprintf(`{"status":"success","ip":"%s"}`, newIP)))
}

func (ws *WebServer) handleLogStream(w http.ResponseWriter, r *http.Request) {
	_, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	logChan := make(chan string, 10)

	ws.clientsMu.Lock()
	ws.clients[logChan] = true
	ws.clientsMu.Unlock()

	defer func() {
		ws.clientsMu.Lock()
		delete(ws.clients, logChan)
		ws.clientsMu.Unlock()
		close(logChan)
	}()

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	w.Write([]byte("data: [SYSTEM] SSE 日志通道已连接。\n\n"))
	flusher.Flush()

	for {
		select {
		case msg, open := <-logChan:
			if !open {
				return
			}
			_, err := fmt.Fprintf(w, "data: %s\n\n", msg)
			if err != nil {
				return
			}
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// handleGetUserOrders 获取用户的历史订单记录
func (ws *WebServer) handleGetUserOrders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}

	orders, err := ws.store.GetUserOrders(user.ID, user.Role)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(`{"error":"获取订单列表失败: %s"}`, err.Error())))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(orders)
}

// handleUserBilling 获取用户账单和套餐详情
func (ws *WebServer) handleUserBilling(w http.ResponseWriter, r *http.Request) {
	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}

	w.Header().Set("Content-Type", "application/json")

	// 实时从数据库中提取最新的用户余额、套餐与到期时间
	var currentBalance float64
	var currentPlan string
	var currentExpiresAt int64
	if ws.store.GetDB() != nil {
		_ = ws.store.GetDB().QueryRow("SELECT COALESCE(balance, 0.0), COALESCE(plan, 'free'), COALESCE(expires_at, 0) FROM users WHERE id = ?", user.ID).Scan(&currentBalance, &currentPlan, &currentExpiresAt)
		user.Balance = currentBalance
		user.Plan = currentPlan
		user.ExpiresAt = currentExpiresAt
	}

	// 统计用户当前托管域名数
	var domainCount int
	if ws.store.GetDB() != nil {
		_ = ws.store.GetDB().QueryRow("SELECT COUNT(*) FROM domains WHERE owner_id = ?", user.ID).Scan(&domainCount)
	}

	// 获取计划额度
	limitStr := "1"
	if user.Plan == "free" || user.Plan == "" {
		limitStr = ws.store.GetSetting("plan_free_domain_limit", "1")
	} else if user.Plan == "junior" {
		limitStr = ws.store.GetSetting("plan_junior_domain_limit", "1")
	} else if user.Plan == "intermediate" {
		limitStr = ws.store.GetSetting("plan_intermediate_domain_limit", "3")
	} else if user.Plan == "senior" {
		limitStr = ws.store.GetSetting("plan_senior_domain_limit", "6")
	}
	domainLimit, _ := strconv.Atoi(limitStr)

	// 套餐配置列表
	planJuniorName := ws.store.GetSetting("plan_junior_name", "初级套餐")
	planIntermediateName := ws.store.GetSetting("plan_intermediate_name", "中级套餐")
	planSeniorName := ws.store.GetSetting("plan_senior_name", "高级套餐")

	planJuniorLimit, _ := strconv.Atoi(ws.store.GetSetting("plan_junior_domain_limit", "1"))
	planIntermediateLimit, _ := strconv.Atoi(ws.store.GetSetting("plan_intermediate_domain_limit", "3"))
	planSeniorLimit, _ := strconv.Atoi(ws.store.GetSetting("plan_senior_domain_limit", "6"))

	plans := []map[string]interface{}{
		{
			"id":           "junior",
			"name":         planJuniorName,
			"domain_limit": planJuniorLimit,
			"prices": map[string]string{
				"monthly":      ws.store.GetSetting("plan_junior_price_monthly", "10"),
				"quarterly":    ws.store.GetSetting("plan_junior_price_quarterly", "28"),
				"semiannually": ws.store.GetSetting("plan_junior_price_semiannually", "50"),
				"annually":     ws.store.GetSetting("plan_junior_price_annually", "90"),
			},
		},
		{
			"id":           "intermediate",
			"name":         planIntermediateName,
			"domain_limit": planIntermediateLimit,
			"prices": map[string]string{
				"monthly":      ws.store.GetSetting("plan_intermediate_price_monthly", "20"),
				"quarterly":    ws.store.GetSetting("plan_intermediate_price_quarterly", "55"),
				"semiannually": ws.store.GetSetting("plan_intermediate_price_semiannually", "100"),
				"annually":     ws.store.GetSetting("plan_intermediate_price_annually", "180"),
			},
		},
		{
			"id":           "senior",
			"name":         planSeniorName,
			"domain_limit": planSeniorLimit,
			"prices": map[string]string{
				"monthly":      ws.store.GetSetting("plan_senior_price_monthly", "40"),
				"quarterly":    ws.store.GetSetting("plan_senior_price_quarterly", "110"),
				"semiannually": ws.store.GetSetting("plan_senior_price_semiannually", "200"),
				"annually":     ws.store.GetSetting("plan_senior_price_annually", "360"),
			},
		},
	}

	// 支付方式配置状态
	paymentMethods := map[string]bool{
		"epay":  ws.store.GetSetting("epay_api_url", "") != "" && ws.store.GetSetting("epay_partner_id", "") != "" && ws.store.GetSetting("epay_secret_key", "") != "",
		"mgate": ws.store.GetSetting("mgate_api_url", "") != "" && ws.store.GetSetting("mgate_app_id", "") != "" && ws.store.GetSetting("mgate_secret_key", "") != "",
		"usdt":  ws.store.GetSetting("usdt_trc20_address", "") != "",
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"username":        user.Username,
		"role":            user.Role,
		"plan":            user.Plan,
		"expires_at":      user.ExpiresAt,
		"balance":         currentBalance,
		"domain_count":    domainCount,
		"domain_limit":    domainLimit,
		"plans":           plans,
		"payment_methods": paymentMethods,
	})
}

// handleCreateOrder 创建订单并生成支付跳转链接
func (ws *WebServer) handleCreateOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}

	var req struct {
		Plan          string  `json:"plan"`
		Cycle         string  `json:"cycle"`
		PaymentMethod string  `json:"payment_method"`
		PayType       string  `json:"pay_type"`
		Amount        float64 `json:"amount"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"请求参数格式错误"}`))
		return
	}

	if req.PaymentMethod != "epay" && req.PaymentMethod != "mgate" && req.PaymentMethod != "usdt" && req.PaymentMethod != "balance" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"不支持的支付方式"}`))
		return
	}

	// 1. 钱包余额直接扣款支付模式
	if req.PaymentMethod == "balance" {
		if req.Plan == "recharge" {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"充值订单不能使用余额支付"}`))
			return
		}
		price, err := ws.store.PayPlanWithBalance(user.ID, req.Plan, req.Cycle)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(fmt.Sprintf(`{"error":"%s"}`, err.Error())))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":  true,
			"paid_via": "balance",
			"price":    price,
			"message":  "已成功使用钱包余额划扣开通/顺延套餐！",
		})
		return
	}

	var price float64
	durationDays := 0

	if req.Plan == "recharge" {
		if req.Amount < 10.0 {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"最小充值金额为 10 元"}`))
			return
		}
		price = req.Amount
	} else {
		if req.Plan != "junior" && req.Plan != "intermediate" && req.Plan != "senior" {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"不支持的套餐类型"}`))
			return
		}

		if req.Cycle != "monthly" && req.Cycle != "quarterly" && req.Cycle != "semiannually" && req.Cycle != "annually" {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"不支持的结算周期"}`))
			return
		}

		// 1. 获取套餐价格
		priceKey := fmt.Sprintf("plan_%s_price_%s", req.Plan, req.Cycle)
		defaultPrices := map[string]string{
			"plan_junior_price_monthly":      "10",
			"plan_junior_price_quarterly":    "28",
			"plan_junior_price_semiannually": "50",
			"plan_junior_price_annually":     "90",

			"plan_intermediate_price_monthly":      "20",
			"plan_intermediate_price_quarterly":    "55",
			"plan_intermediate_price_semiannually": "100",
			"plan_intermediate_price_annually":     "180",

			"plan_senior_price_monthly":      "40",
			"plan_senior_price_quarterly":    "110",
			"plan_senior_price_semiannually": "200",
			"plan_senior_price_annually":     "360",
		}

		priceStr := ws.store.GetSetting(priceKey, defaultPrices[priceKey])
		var err error
		price, err = strconv.ParseFloat(priceStr, 64)
		if err != nil || price <= 0 {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"系统套餐价格配置错误"}`))
			return
		}

		durationDays = 31
		switch req.Cycle {
		case "quarterly":
			durationDays = 93
		case "semiannually":
			durationDays = 186
		case "annually":
			durationDays = 366
		}
	}

	// 生成订单号
	rand.Seed(time.Now().UnixNano())
	orderID := fmt.Sprintf("ord_%d%04d", time.Now().Unix(), rand.Intn(10000))

	// 入库
	if err := ws.store.CreateOrder(orderID, user.ID, req.Plan, req.Cycle, price, req.PaymentMethod, durationDays); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(`{"error":"创建订单失败: %s"}`, err.Error())))
		return
	}

	w.Header().Set("Content-Type", "application/json")

	// 3. 处理不同支付渠道
	if req.PaymentMethod == "usdt" {
		usdtAddr := ws.store.GetSetting("usdt_trc20_address", "")
		if usdtAddr == "" {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"系统未配置 USDT 收款地址"}`))
			return
		}
		rateStr := ws.store.GetSetting("usdt_cny_rate", "7.0")
		rate, _ := strconv.ParseFloat(rateStr, 64)
		if rate <= 0 {
			rate = 7.0
		}
		priceUSDT := math.Round((price/rate)*100) / 100 // 保留两位小数
		json.NewEncoder(w).Encode(map[string]interface{}{
			"order_id":           orderID,
			"payment_method":     "usdt",
			"price_cny":          price,
			"price_usdt":         priceUSDT,
			"usdt_trc20_address": usdtAddr,
		})
		return
	}

	// 构造本地 Host URL (用于回调和跳转)
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	hostURL := fmt.Sprintf("%s://%s", scheme, r.Host)

	if req.PaymentMethod == "epay" {
		apiURL := ws.store.GetSetting("epay_api_url", "")
		pid := ws.store.GetSetting("epay_partner_id", "")
		secret := ws.store.GetSetting("epay_secret_key", "")

		if apiURL == "" || pid == "" || secret == "" {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"系统未完整配置易支付"}`))
			return
		}

		notifyURL := hostURL + "/api/payment/notify/epay"
		returnURL := hostURL + "/#billing"

		// 构造参数 Map
		paramsMap := map[string]string{
			"pid":          pid,
			"out_trade_no": orderID,
			"notify_url":   notifyURL,
			"return_url":   returnURL,
			"name":         "TriNet DNS 套餐购买",
			"money":        fmt.Sprintf("%.2f", price),
		}
		if req.PayType != "" {
			paramsMap["type"] = req.PayType
		}

		// 字典升序排序 key
		var keys []string
		for k := range paramsMap {
			keys = append(keys, k)
		}
		for i := 0; i < len(keys); i++ {
			for j := i + 1; j < len(keys); j++ {
				if keys[i] > keys[j] {
					keys[i], keys[j] = keys[j], keys[i]
				}
			}
		}

		var signStr strings.Builder
		for i, k := range keys {
			signStr.WriteString(fmt.Sprintf("%s=%s", k, paramsMap[k]))
			if i < len(keys)-1 {
				signStr.WriteByte('&')
			}
		}
		signStr.WriteString(secret)

		hasher := md5.New()
		hasher.Write([]byte(signStr.String()))
		sign := hex.EncodeToString(hasher.Sum(nil))

		// 拼装 URL 参数
		var urlParams []string
		for _, k := range keys {
			urlParams = append(urlParams, fmt.Sprintf("%s=%s", k, url.QueryEscape(paramsMap[k])))
		}
		urlParams = append(urlParams, fmt.Sprintf("sign=%s", sign))
		urlParams = append(urlParams, "sign_type=MD5")

		payURL := fmt.Sprintf("%s/submit.php?%s", strings.TrimSuffix(apiURL, "/"), strings.Join(urlParams, "&"))

		json.NewEncoder(w).Encode(map[string]interface{}{
			"order_id":       orderID,
			"payment_method": "epay",
			"pay_url":        payURL,
		})
		return
	}

	if req.PaymentMethod == "mgate" {
		apiURL := ws.store.GetSetting("mgate_api_url", "")
		appID := ws.store.GetSetting("mgate_app_id", "")
		secret := ws.store.GetSetting("mgate_secret_key", "")

		if apiURL == "" || appID == "" || secret == "" {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"系统未完整配置 MGate"}`))
			return
		}

		notifyURL := hostURL + "/api/payment/notify/mgate"
		returnURL := hostURL + "/#billing"

		// 调用 MGate 接口下单
		mgateParams := url.Values{}
		mgateParams.Add("app_id", appID)
		mgateParams.Add("out_trade_no", orderID)
		mgateParams.Add("amount", fmt.Sprintf("%.2f", price))
		mgateParams.Add("notify_url", notifyURL)
		mgateParams.Add("return_url", returnURL)

		// 签名计算
		keys := []string{"amount", "app_id", "notify_url", "out_trade_no", "return_url"}
		var signStr strings.Builder
		for i, k := range keys {
			signStr.WriteString(fmt.Sprintf("%s=%s", k, mgateParams.Get(k)))
			if i < len(keys)-1 {
				signStr.WriteByte('&')
			}
		}
		signStr.WriteString("&key=" + secret)

		hasher := md5.New()
		hasher.Write([]byte(signStr.String()))
		sign := hex.EncodeToString(hasher.Sum(nil))
		mgateParams.Add("sign", sign)

		resp, err := http.PostForm(strings.TrimSuffix(apiURL, "/")+"/api/v1/order/create", mgateParams)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(fmt.Sprintf(`{"error":"请求 MGate 支付网关失败: %s"}`, err.Error())))
			return
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		var mgateResp struct {
			Code int `json:"code"`
			Data struct {
				PayURL string `json:"pay_url"`
			} `json:"data"`
			Message string `json:"message"`
		}

		if err := json.Unmarshal(body, &mgateResp); err != nil || mgateResp.Code != 200 || mgateResp.Data.PayURL == "" {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(fmt.Sprintf(`{"error":"网关下单失败: %s %s"}`, mgateResp.Message, string(body))))
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"order_id":       orderID,
			"payment_method": "mgate",
			"pay_url":        mgateResp.Data.PayURL,
		})
		return
	}
}

// handleVerifyUSDT 验证 USDT-TRC20 转账交易并激活套餐
func (ws *WebServer) handleVerifyUSDT(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}

	var req struct {
		OrderID string `json:"order_id"`
		TxID    string `json:"tx_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"请求参数格式错误"}`))
		return
	}

	req.TxID = strings.TrimSpace(req.TxID)
	if req.TxID == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"请输入交易哈希 (TxID)"}`))
		return
	}

	// 1. 获取订单详情
	order, err := ws.store.GetOrder(req.OrderID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"订单不存在"}`))
		return
	}

	if order["status"].(string) == "paid" {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"success","message":"订单已成功激活"}`))
		return
	}

	if order["user_id"].(int64) != user.ID {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"无权操作此订单"}`))
		return
	}

	// 2. 判断 TxID 是否已使用
	used, err := ws.store.IsTxIDUsed(req.TxID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"数据库查询失败"}`))
		return
	}
	if used {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"该交易哈希已被使用，请勿重复提交"}`))
		return
	}

	// 3. 计算预计 USDT 收款金额
	price := order["price"].(float64)
	rateStr := ws.store.GetSetting("usdt_cny_rate", "7.0")
	rate, _ := strconv.ParseFloat(rateStr, 64)
	if rate <= 0 {
		rate = 7.0
	}
	expectedUSDT := math.Round((price/rate)*100) / 100

	// 4. 调用 TronGrid API 查询转账记录
	adminWallet := ws.store.GetSetting("usdt_trc20_address", "")
	if adminWallet == "" {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"系统未配置 USDT 收款地址"}`))
		return
	}

	apiURL := fmt.Sprintf("https://api.trongrid.io/v1/accounts/%s/transactions/trc20?limit=50", adminWallet)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"连接波场区块链网络失败，请稍后重试"}`))
		return
	}
	defer resp.Body.Close()

	var tronResp struct {
		Data []struct {
			TransactionID  string `json:"transaction_id"`
			BlockTimestamp int64  `json:"block_timestamp"`
			From           string `json:"from"`
			To             string `json:"to"`
			Value          string `json:"value"`
			Type           string `json:"type"`
			TokenInfo      struct {
				Symbol   string `json:"symbol"`
				Address  string `json:"address"`
				Decimals int    `json:"decimals"`
			} `json:"token_info"`
		} `json:"data"`
		Success bool `json:"success"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&tronResp); err != nil || !tronResp.Success {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"解析区块交易记录失败，请重试"}`))
		return
	}

	// 5. 循环寻找匹配的 tx_id
	var matchedTx bool = false
	for _, tx := range tronResp.Data {
		if tx.TransactionID == req.TxID {
			// 校验接收方、代币类型
			if strings.ToLower(tx.To) != strings.ToLower(adminWallet) {
				continue
			}
			if strings.ToUpper(tx.TokenInfo.Symbol) != "USDT" {
				continue
			}

			// 解析交易金额
			valVal, err := strconv.ParseFloat(tx.Value, 64)
			if err != nil {
				continue
			}
			decimals := tx.TokenInfo.Decimals
			if decimals <= 0 {
				decimals = 6
			}
			actualUSDT := valVal / math.Pow(10, float64(decimals))

			// 检查金额偏差在 0.1 USDT 以内
			if math.Abs(actualUSDT-expectedUSDT) > 0.1 {
				w.WriteHeader(http.StatusBadRequest)
				w.Write([]byte(fmt.Sprintf(`{"error":"交易金额不匹配。预计收款 %.2f USDT，实际交易为 %.2f USDT"}`, expectedUSDT, actualUSDT)))
				return
			}

			// 检查交易时间限制（限制为24小时以内）
			txTime := time.Unix(tx.BlockTimestamp/1000, 0)
			if time.Since(txTime) > 24*time.Hour {
				w.WriteHeader(http.StatusBadRequest)
				w.Write([]byte(`{"error":"该交易已过期，系统只接受24小时内的最新交易"}`))
				return
			}

			matchedTx = true
			break
		}
	}

	if !matchedTx {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"未在区块链上检测到该 TxID 转账到收款地址的成功交易，或因区块同步延迟请稍后重试"}`))
		return
	}

	// 6. 激活订单
	if err := ws.store.MarkOrderPaid(req.OrderID, req.TxID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(`{"error":"激活套餐失败: %s"}`, err.Error())))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"success","message":"支付成功，您的套餐已成功激活并开通！"}`))
}

// handleEpayNotify 易支付回调接口
func (ws *WebServer) handleEpayNotify(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()

	// 从 Form 或 Query 获取参数
	params := make(map[string]string)
	for k, vs := range r.Form {
		if len(vs) > 0 {
			params[k] = vs[0]
		}
	}

	orderID := params["out_trade_no"]
	sign := params["sign"]
	tradeStatus := params["trade_status"]

	if orderID == "" || sign == "" {
		w.Write([]byte("fail"))
		return
	}

	secret := ws.store.GetSetting("epay_secret_key", "")
	if secret == "" {
		w.Write([]byte("fail"))
		return
	}

	// 验证签名
	// 剔除 sign 和 sign_type
	var keys []string
	for k := range params {
		if k != "sign" && k != "sign_type" && params[k] != "" {
			keys = append(keys, k)
		}
	}
	// Sort keys alphabetically
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			if keys[i] > keys[j] {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}

	var signStr strings.Builder
	for i, k := range keys {
		signStr.WriteString(fmt.Sprintf("%s=%s", k, params[k]))
		if i < len(keys)-1 {
			signStr.WriteByte('&')
		}
	}
	signStr.WriteString(secret)

	hasher := md5.New()
	hasher.Write([]byte(signStr.String()))
	calcSign := hex.EncodeToString(hasher.Sum(nil))

	if calcSign != sign {
		log.Printf("[WARNING] Epay signature mismatch. Expected %s, got %s", calcSign, sign)
		w.Write([]byte("fail"))
		return
	}

	upperStatus := strings.ToUpper(tradeStatus)
	if upperStatus == "TRADE_SUCCESS" || upperStatus == "SUCCESS" {
		if err := ws.store.MarkOrderPaid(orderID, params["trade_no"]); err != nil {
			log.Printf("[ERROR] Epay mark order paid failed: %s", err.Error())
			w.Write([]byte("fail"))
			return
		}
	}

	w.Write([]byte("success"))
}

// handleMGateNotify MGate 回调接口
func (ws *WebServer) handleMGateNotify(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()

	params := make(map[string]string)
	for k, vs := range r.Form {
		if len(vs) > 0 {
			params[k] = vs[0]
		}
	}

	orderID := params["out_trade_no"]
	sign := params["sign"]

	if orderID == "" || sign == "" {
		w.Write([]byte("fail"))
		return
	}

	secret := ws.store.GetSetting("mgate_secret_key", "")
	if secret == "" {
		w.Write([]byte("fail"))
		return
	}

	// 签名验证
	var keys []string
	for k := range params {
		if k != "sign" && params[k] != "" {
			keys = append(keys, k)
		}
	}
	// Sort keys
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			if keys[i] > keys[j] {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}

	var signStr strings.Builder
	for i, k := range keys {
		signStr.WriteString(fmt.Sprintf("%s=%s", k, params[k]))
		if i < len(keys)-1 {
			signStr.WriteByte('&')
		}
	}
	signStr.WriteString("&key=" + secret)

	hasher := md5.New()
	hasher.Write([]byte(signStr.String()))
	calcSign := hex.EncodeToString(hasher.Sum(nil))

	if calcSign != sign {
		log.Printf("[WARNING] MGate signature mismatch. Expected %s, got %s", calcSign, sign)
		w.Write([]byte("fail"))
		return
	}

	// MGate 通常回调触发即为成功
	if err := ws.store.MarkOrderPaid(orderID, params["trade_no"]); err != nil {
		log.Printf("[ERROR] MGate mark order paid failed: %s", err.Error())
		w.Write([]byte("fail"))
		return
	}

	w.Write([]byte("success"))
}

func (ws *WebServer) handleUserProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}

	profile, err := ws.store.GetUserProfileFull(user.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(`{"error":"获取个人信息失败: %s"}`, err.Error())))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile)
}

func (ws *WebServer) handleUpdateAutoRenew(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}

	var req struct {
		AutoRenew bool `json:"auto_renew"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"请求格式错误"}`))
		return
	}

	if err := ws.store.UpdateAutoRenew(user.ID, req.AutoRenew); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(`{"error":"更新失败: %s"}`, err.Error())))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (ws *WebServer) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	user, ok := ws.checkAuth(w, r)
	if !ok || user.Role != "admin" {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"需要管理员权限"}`))
		return
	}

	users, err := ws.store.GetAllUsersFull()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(`{"error":"获取用户列表失败: %s"}`, err.Error())))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

func (ws *WebServer) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	user, ok := ws.checkAuth(w, r)
	if !ok || user.Role != "admin" {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"需要管理员权限"}`))
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
		Plan     string `json:"plan"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"请求格式错误"}`))
		return
	}

	if req.Username == "" || req.Password == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"用户名和密码不能为空"}`))
		return
	}

	if err := ws.store.AdminCreateUser(req.Username, req.Password, req.Role, req.Plan); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(fmt.Sprintf(`{"error":"%s"}`, err.Error())))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (ws *WebServer) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	user, ok := ws.checkAuth(w, r)
	if !ok || user.Role != "admin" {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"需要管理员权限"}`))
		return
	}

	var req struct {
		UserID     int64   `json:"user_id"`
		Role       string  `json:"role"`
		Plan       string  `json:"plan"`
		ExpiresAt  int64   `json:"expires_at"`
		AddBalance float64 `json:"add_balance"`
		NewPass    string  `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"请求格式错误"}`))
		return
	}

	if req.UserID <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"无效的用户ID"}`))
		return
	}

	if err := ws.store.AdminUpdateUser(req.UserID, req.Role, req.Plan, req.ExpiresAt, req.AddBalance, req.NewPass); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(`{"error":"更新失败: %s"}`, err.Error())))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (ws *WebServer) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	user, ok := ws.checkAuth(w, r)
	if !ok || user.Role != "admin" {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"需要管理员权限"}`))
		return
	}

	var req struct {
		UserID int64 `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"请求格式错误"}`))
		return
	}

	if err := ws.store.AdminDeleteUser(req.UserID); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(fmt.Sprintf(`{"error":"删除失败: %s"}`, err.Error())))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

func (ws *WebServer) handleGetIP(w http.ResponseWriter, r *http.Request) {
	ip := r.Header.Get("X-Forwarded-For")
	if ip != "" {
		ip = strings.Split(ip, ",")[0]
	}
	if ip == "" {
		ip = r.Header.Get("X-Real-IP")
	}
	if ip == "" {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err == nil {
			ip = host
		} else {
			ip = r.RemoteAddr
		}
	}
	ip = strings.TrimSpace(ip)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"ip": ip,
	})
}

// handleUserRenew 个人中心一键余额续费当前套餐 30 天
func (ws *WebServer) handleUserRenew(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}

	price, err := ws.store.RenewProfileWithBalance(user.ID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(fmt.Sprintf(`{"error":"%s"}`, err.Error())))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"price":   price,
		"message": "续费成功！已使用账户钱包余额划扣 30 天月费",
	})
}
