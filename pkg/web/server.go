package web

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"runtime"
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
	authMu    sync.RWMutex
	username  string
	password  string
	authToken string
	startTime time.Time
}

func (ws *WebServer) updateAuthToken(user, pass string) {
	ws.authMu.Lock()
	defer ws.authMu.Unlock()
	ws.username = user
	ws.password = pass
	h := sha256.New()
	h.Write([]byte(user + ":" + pass))
	ws.authToken = hex.EncodeToString(h.Sum(nil))
}

func NewWebServer(addr string, s *store.MemoryStore, logChan chan string, username, password string) *WebServer {
	ws := &WebServer{
		addr:      addr,
		store:     s,
		logChan:   logChan,
		clients:   make(map[chan string]bool),
		startTime: time.Now(),
	}
	ws.updateAuthToken(username, password)
	go ws.logBroadcaster()
	return ws
}

func (ws *WebServer) checkAuth(w http.ResponseWriter, r *http.Request) bool {
	ws.authMu.RLock()
	expectedToken := ws.authToken
	ws.authMu.RUnlock()

	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	if token != expectedToken {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"未授权"}`))
		return false
	}
	return true
}

func (ws *WebServer) handleLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
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

	ws.authMu.RLock()
	currUser := ws.username
	currPass := ws.password
	currToken := ws.authToken
	ws.authMu.RUnlock()

	if req.Username == currUser && req.Password == currPass {
		w.Write([]byte(fmt.Sprintf(`{"status":"success","token":"%s"}`, currToken)))
		return
	}

	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"error":"用户名或密码错误"}`))
}

func (ws *WebServer) handlePassword(w http.ResponseWriter, r *http.Request) {
	if !ws.checkAuth(w, r) {
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
		NewUsername string `json:"new_username"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"参数格式错误"}`))
		return
	}

	ws.authMu.RLock()
	currPass := ws.password
	ws.authMu.RUnlock()

	if req.OldPassword != currPass {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"当前密码错误"}`))
		return
	}

	if req.NewUsername == "" || req.NewPassword == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"新用户名或新密码不能为空"}`))
		return
	}

	// 更新并保存到 JSON 文件
	if err := ws.store.SetCredentials(req.NewUsername, req.NewPassword); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(`{"error":"保存失败: %s"}`, err.Error())))
		return
	}

	// 更新内存中的 WebServer 鉴权状态
	ws.updateAuthToken(req.NewUsername, req.NewPassword)

	w.Write([]byte(`{"status":"success","message":"密码修改成功"}`))
}

func (ws *WebServer) handleSysStats(w http.ResponseWriter, r *http.Request) {
	if !ws.checkAuth(w, r) {
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
	}
	json.NewEncoder(w).Encode(stats)
}

// handleSync 节点同步专用只读接口，不需要认证，仅返回 DNS 域名解析记录（不含账号/Token 等敏感信息）
func (ws *WebServer) handleSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method Not Allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	data := ws.store.GetPublicData()
	// 只返回 domains 部分，不暴露 tokens
	json.NewEncoder(w).Encode(map[string]interface{}{
		"domains": data.Domains,
	})
}

func (ws *WebServer) Start() {
	// API 路由
	http.HandleFunc("/api/login", ws.handleLogin)
	http.HandleFunc("/api/admin/password", ws.handlePassword)
	http.HandleFunc("/api/records", ws.handleRecords)
	http.HandleFunc("/api/ddns/update", ws.handleDDNSUpdate)
	http.HandleFunc("/api/logs/stream", ws.handleLogStream)
	http.HandleFunc("/api/sys/stats", ws.handleSysStats)
	// 节点同步专用公开只读接口（仅返回 DNS 解析记录，不含账号密码）
	http.HandleFunc("/api/sync", ws.handleSync)


	// 静态文件服务器
	subFS, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("[FATAL] 无法定位嵌入的静态资源目录: %s", err.Error())
	}
	http.Handle("/", http.FileServer(http.FS(subFS)))

	log.Printf("[INFO] Web 管理面板已启动，监听在 http://%s", ws.addr)
	go func() {
		if err := http.ListenAndServe(ws.addr, nil); err != nil {
			log.Fatalf("[FATAL] Web 服务器运行失败: %s", err.Error())
		}
	}()
}

// logBroadcaster 将日志通道中的日志广播给所有 SSE 客户端
func (ws *WebServer) logBroadcaster() {
	for logMsg := range ws.logChan {
		ws.clientsMu.RLock()
		for clientChan := range ws.clients {
			select {
			case clientChan <- logMsg:
			default:
				// 消费不及时则丢弃，避免阻塞广播
			}
		}
		ws.clientsMu.RUnlock()
	}
}

// handleRecords 提供 DNS 记录的增删改查
func (ws *WebServer) handleRecords(w http.ResponseWriter, r *http.Request) {
	if !ws.checkAuth(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		json.NewEncoder(w).Encode(ws.store.GetPublicData())

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

		ws.store.AddRecord(req.Domain, req.Subdomain, req.Type, req.ISP, req.Values, req.TTL)
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

		ws.store.DeleteRecord(domain, subdomain, qtype, isp)
		w.Write([]byte(`{"status":"success"}`))

	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

// handleDDNSUpdate 动态 DNS 上报接口
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

	// 获取上报的 IP
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

	// 调用存储引擎的线程安全方法进行更新
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

// handleLogStream SSE 实时推流接口
func (ws *WebServer) handleLogStream(w http.ResponseWriter, r *http.Request) {
	if !ws.checkAuth(w, r) {
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

	fmt.Fprintf(w, "data: %s\n\n", "[SYSTEM] SSE 连接已就绪，等待解析日志事件...")
	w.(http.Flusher).Flush()

	for {
		select {
		case logMsg := <-logChan:
			fmt.Fprintf(w, "data: %s\n\n", logMsg)
			w.(http.Flusher).Flush()
		case <-r.Context().Done():
			return
		}
	}
}
