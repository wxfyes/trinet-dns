package web

import (
	"embed"
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
	startTime time.Time
	syncToken string
	nsNodes   string
	openReg   bool
}

func NewWebServer(addr string, s *store.MemoryStore, logChan chan string, username, password string, syncToken string, nsNodes string, openReg bool) *WebServer {
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
			"open_registration": ws.openReg,
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

	if !ws.openReg {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"注册已关闭"}`))
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

	if req.Username == "" || req.Password == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"用户名与密码不能为空"}`))
		return
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
		"ns_nodes":    ws.nsNodes,
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
	http.HandleFunc("/api/records", ws.handleRecords)
	http.HandleFunc("/api/ddns/token", ws.handleDDNSToken)
	http.HandleFunc("/api/ddns/update", ws.handleDDNSUpdate)
	http.HandleFunc("/api/logs/stream", ws.handleLogStream)
	http.HandleFunc("/api/sys/stats", ws.handleSysStats)
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

func (ws *WebServer) handleDDNSToken(w http.ResponseWriter, r *http.Request) {
	user, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
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
