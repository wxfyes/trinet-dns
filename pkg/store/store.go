package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/glebarez/go-sqlite"
)

// User 表示系统中的用户账号
type User struct {
	ID         int64   `json:"id"`
	Username   string  `json:"username"`
	Role       string  `json:"role"` // "admin" 或 "user"
	Plan       string  `json:"plan"`
	ExpiresAt  int64   `json:"expires_at"`
	Balance    float64 `json:"balance"`
	AutoRenew  bool    `json:"auto_renew"`
	TelegramID string  `json:"telegram_id"`
}

// DNSRecord 表示一条具体的 DNS 解析记录
type DNSRecord struct {
	Subdomain string   `json:"subdomain"` // 主机记录，如 "www"
	Type      string   `json:"type"`      // "A", "AAAA", "CNAME"
	ISP       string   `json:"isp"`       // "ct", "cu", "cm", "def"
	Values    []string `json:"values"`    // 解析值，如 ["1.1.1.1"]
	TTL       uint32   `json:"ttl"`       // 缓存生命周期
}

// DomainRecords 包含一个域名下所有子域名的路由解析记录
type DomainRecords struct {
	OwnerID int64                  `json:"owner_id"` // 域名拥有者ID
	TTL     uint32                 `json:"ttl"`
	Records map[string][]DNSRecord `json:"records"` // key: "Subdomain_Type"
}

// MemoryStore 内存解析记录存储（支持持久化为 SQLite 数据库，并支持从旧 JSON 迁移）
type MemoryStore struct {
	mu          sync.RWMutex
	filePath    string
	db          *sql.DB
	Domains     map[string]*DomainRecords `json:"domains"`
	Tokens      map[string]string         `json:"tokens"` // key: token, value: subdomain.domain_isp
	WebUser     string                    `json:"web_user,omitempty"`
	WebPass     string                    `json:"web_pass,omitempty"`
	queryCount  uint64
	ispQueryMap map[string]uint64
}

func NewMemoryStore(filePath string) *MemoryStore {
	store := &MemoryStore{
		filePath:    filePath,
		Domains:     make(map[string]*DomainRecords),
		Tokens:      make(map[string]string),
		ispQueryMap: make(map[string]uint64),
	}
	store.Load()
	return store
}

func (s *MemoryStore) GetCredentials() (string, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.WebUser, s.WebPass
}

func (s *MemoryStore) SetCredentials(user, pass string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.WebUser = user
	s.WebPass = pass

	if s.db != nil {
		_, err := s.db.Exec("UPDATE users SET username = ?, password_hash = ? WHERE role = 'admin'", user, pass)
		return err
	}
	return nil
}

// RecordQuery 记录一次解析查询
func (s *MemoryStore) RecordQuery(isp string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.queryCount++
	if s.ispQueryMap == nil {
		s.ispQueryMap = make(map[string]uint64)
	}
	s.ispQueryMap[isp]++
}

// GetQueryStats 获取当前解析查询统计数据
func (s *MemoryStore) GetQueryStats() (uint64, map[string]uint64) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := make(map[string]uint64)
	for k, v := range s.ispQueryMap {
		m[k] = v
	}
	return s.queryCount, m
}

// Load 初始化 SQLite 并加载数据，支持从 JSON 文件自动迁移
func (s *MemoryStore) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.filePath == "" {
		return nil
	}

	dbPath := s.filePath
	isJSON := strings.HasSuffix(strings.ToLower(s.filePath), ".json")
	if isJSON {
		dbPath = strings.TrimSuffix(s.filePath, ".json") + ".db"
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open sqlite db: %w", err)
	}
	s.db = db

	// 创建表结构
	query := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE,
		password_hash TEXT,
		role TEXT
	);
	CREATE TABLE IF NOT EXISTS domains (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE,
		owner_id INTEGER,
		ttl INTEGER
	);
	CREATE TABLE IF NOT EXISTS dns_records (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		domain_id INTEGER,
		subdomain TEXT,
		type TEXT,
		isp TEXT,
		values_text TEXT,
		ttl INTEGER,
		FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS ddns_tokens (
		token TEXT PRIMARY KEY,
		record_info TEXT
	);
	CREATE TABLE IF NOT EXISTS user_sessions (
		token TEXT PRIMARY KEY,
		user_id INTEGER,
		expires_at INTEGER,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);
	CREATE TABLE IF NOT EXISTS sys_settings (
		key TEXT PRIMARY KEY,
		value TEXT
	);
	CREATE TABLE IF NOT EXISTS orders (
		order_id TEXT PRIMARY KEY,
		user_id INTEGER,
		plan TEXT,
		cycle TEXT,
		price REAL,
		payment_method TEXT,
		status TEXT,
		tx_id TEXT,
		created_at INTEGER,
		updated_at INTEGER,
		duration_days INTEGER,
		FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
	);
	`
	if _, err := s.db.Exec(query); err != nil {
		return fmt.Errorf("failed to init db tables: %w", err)
	}

	// 执行表结构升级 (平滑升级旧数据库表)
	_, _ = s.db.Exec("ALTER TABLE domains ADD COLUMN owner_id INTEGER DEFAULT 1;")
	_, _ = s.db.Exec("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free';")
	_, _ = s.db.Exec("ALTER TABLE users ADD COLUMN expires_at INTEGER DEFAULT 0;")
	_, _ = s.db.Exec("ALTER TABLE users ADD COLUMN balance REAL DEFAULT 0;")
	_, _ = s.db.Exec("ALTER TABLE users ADD COLUMN auto_renew INTEGER DEFAULT 0;")
	_, _ = s.db.Exec("ALTER TABLE users ADD COLUMN telegram_id TEXT DEFAULT '';")

	// 检查并执行 JSON 迁移
	if isJSON {
		if _, err := os.Stat(s.filePath); err == nil {
			if err := s.migrateFromJSON(s.filePath); err != nil {
				return fmt.Errorf("failed to migrate legacy JSON: %w", err)
			}
		}
	}

	// 从 SQLite 载入数据到内存
	if err := s.loadFromDB(); err != nil {
		return fmt.Errorf("failed to load data from db: %w", err)
	}

	return nil
}

func (s *MemoryStore) migrateFromJSON(jsonPath string) error {
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return err
	}

	var legacy struct {
		Domains map[string]*DomainRecords `json:"domains"`
		Tokens  map[string]string         `json:"tokens"`
		WebUser string                    `json:"web_user"`
		WebPass string                    `json:"web_pass"`
	}
	if err := json.Unmarshal(data, &legacy); err != nil {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. 迁移用户密码
	if legacy.WebUser != "" && legacy.WebPass != "" {
		_, err = tx.Exec("INSERT OR REPLACE INTO users (id, username, password_hash, role) VALUES (1, ?, ?, ?)", legacy.WebUser, legacy.WebPass, "admin")
		if err != nil {
			return err
		}
	}

	// 2. 迁移域名及解析记录
	for domName, domObj := range legacy.Domains {
		ownerID := domObj.OwnerID
		if ownerID == 0 {
			ownerID = 1 // 默认为管理员
		}
		_, err = tx.Exec("INSERT OR IGNORE INTO domains (name, owner_id, ttl) VALUES (?, ?, ?)", domName, ownerID, domObj.TTL)
		if err != nil {
			return err
		}
		var domID int64
		err = tx.QueryRow("SELECT id FROM domains WHERE name = ?", domName).Scan(&domID)
		if err != nil {
			return err
		}

		for _, recordList := range domObj.Records {
			for _, rec := range recordList {
				valsText := strings.Join(rec.Values, ",")
				_, err = tx.Exec("INSERT INTO dns_records (domain_id, subdomain, type, isp, values_text, ttl) VALUES (?, ?, ?, ?, ?, ?)",
					domID, rec.Subdomain, rec.Type, rec.ISP, valsText, rec.TTL)
				if err != nil {
					return err
				}
			}
		}
	}

	// 3. 迁移 DDNS Token
	for token, target := range legacy.Tokens {
		_, err = tx.Exec("INSERT OR REPLACE INTO ddns_tokens (token, record_info) VALUES (?, ?)", token, target)
		if err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// 备份原 JSON 文件防止重复迁移
	_ = os.Rename(jsonPath, jsonPath+".bak")
	return nil
}

func (s *MemoryStore) loadFromDB() error {
	// 1. 载入 Web 管理员账户
	var userCount int
	err := s.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount)
	if err != nil {
		return err
	}
	if userCount == 0 {
		_, err = s.db.Exec("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", "admin", "admin123", "admin")
		if err != nil {
			return err
		}
		s.WebUser = "admin"
		s.WebPass = "admin123"

		// 新初始化数据库，注入默认示例解析记录
		s.initDefaultData()

		// 同步写入 SQLite
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		for domName, domObj := range s.Domains {
			ownerID := domObj.OwnerID
			if ownerID == 0 {
				ownerID = 1
			}
			_, err = tx.Exec("INSERT OR IGNORE INTO domains (name, owner_id, ttl) VALUES (?, ?, ?)", domName, ownerID, domObj.TTL)
			if err != nil {
				return err
			}
			var domID int64
			err = tx.QueryRow("SELECT id FROM domains WHERE name = ?", domName).Scan(&domID)
			if err != nil {
				return err
			}

			for _, recordList := range domObj.Records {
				for _, rec := range recordList {
					valsText := strings.Join(rec.Values, ",")
					_, err = tx.Exec("INSERT INTO dns_records (domain_id, subdomain, type, isp, values_text, ttl) VALUES (?, ?, ?, ?, ?, ?)",
						domID, rec.Subdomain, rec.Type, rec.ISP, valsText, rec.TTL)
					if err != nil {
						return err
					}
				}
			}
		}

		for token, target := range s.Tokens {
			_, err = tx.Exec("INSERT OR REPLACE INTO ddns_tokens (token, record_info) VALUES (?, ?)", token, target)
			if err != nil {
				return err
			}
		}

		if err := tx.Commit(); err != nil {
			return err
		}
	} else {
		err = s.db.QueryRow("SELECT username, password_hash FROM users WHERE role = 'admin' LIMIT 1").Scan(&s.WebUser, &s.WebPass)
		if err != nil {
			return err
		}
	}

	// 2. 载入所有域名
	domRows, err := s.db.Query("SELECT id, name, owner_id, ttl FROM domains")
	if err != nil {
		return err
	}
	defer domRows.Close()

	s.Domains = make(map[string]*DomainRecords)

	type dbDom struct {
		id      int64
		name    string
		ownerID int64
		ttl     uint32
	}
	var dbDoms []dbDom
	for domRows.Next() {
		var d dbDom
		if err := domRows.Scan(&d.id, &d.name, &d.ownerID, &d.ttl); err != nil {
			return err
		}
		dbDoms = append(dbDoms, d)
		s.Domains[d.name] = &DomainRecords{
			OwnerID: d.ownerID,
			TTL:     d.ttl,
			Records: make(map[string][]DNSRecord),
		}
	}

	// 3. 载入域名下的解析记录
	for _, d := range dbDoms {
		recRows, err := s.db.Query("SELECT subdomain, type, isp, values_text, ttl FROM dns_records WHERE domain_id = ?", d.id)
		if err != nil {
			return err
		}

		domObj := s.Domains[d.name]
		for recRows.Next() {
			var rec DNSRecord
			var valsText string
			if err := recRows.Scan(&rec.Subdomain, &rec.Type, &rec.ISP, &valsText, &rec.TTL); err != nil {
				recRows.Close()
				return err
			}
			rec.Values = strings.Split(valsText, ",")
			key := rec.Subdomain + "_" + rec.Type
			domObj.Records[key] = append(domObj.Records[key], rec)
		}
		recRows.Close()
	}

	// 4. 载入 DDNS Token
	tokRows, err := s.db.Query("SELECT token, record_info FROM ddns_tokens")
	if err != nil {
		return err
	}
	defer tokRows.Close()

	s.Tokens = make(map[string]string)
	for tokRows.Next() {
		var token, info string
		if err := tokRows.Scan(&token, &info); err != nil {
			return err
		}
		s.Tokens[token] = info
	}

	return nil
}

func (s *MemoryStore) saveUnlocked() error {
	if s.db == nil {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 全量同步 Token 表
	_, _ = tx.Exec("DELETE FROM ddns_tokens")
	for token, target := range s.Tokens {
		_, err = tx.Exec("INSERT INTO ddns_tokens (token, record_info) VALUES (?, ?)", token, target)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

type PublicStoreData struct {
	Domains map[string]*DomainRecords `json:"domains"`
	Tokens  map[string]string         `json:"tokens"`
}

// GetPublicData 获取用于公网展示的脱敏数据
func (s *MemoryStore) GetPublicData() PublicStoreData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return PublicStoreData{
		Domains: s.Domains,
		Tokens:  s.Tokens,
	}
}

// GetUserData 根据用户身份获取隔离过滤后的解析数据与 Token
func (s *MemoryStore) GetUserData(userID int64, role string) PublicStoreData {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if role == "admin" {
		return PublicStoreData{
			Domains: s.Domains,
			Tokens:  s.Tokens,
		}
	}

	// 过滤域名记录
	filteredDomains := make(map[string]*DomainRecords)
	for name, dom := range s.Domains {
		if dom.OwnerID == userID {
			filteredDomains[name] = dom
		}
	}

	// 过滤与用户拥有的域名匹配的 DDNS Token
	filteredTokens := make(map[string]string)
	for token, target := range s.Tokens {
		parts := strings.Split(target, "_")
		if len(parts) >= 2 {
			fqdn := parts[0]
			for domName := range filteredDomains {
				if fqdn == domName || strings.HasSuffix(fqdn, "."+domName) {
					filteredTokens[token] = target
					break
				}
			}
		}
	}

	return PublicStoreData{
		Domains: filteredDomains,
		Tokens:  filteredTokens,
	}
}

// GetDomains 获取所有已托管域名
func (s *MemoryStore) GetDomains() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	domains := make([]string, 0, len(s.Domains))
	for dom := range s.Domains {
		domains = append(domains, dom)
	}
	return domains
}

// LoadDataFromMap 同步时写入数据 (节点 Agent 模式使用)
func (s *MemoryStore) LoadDataFromMap(domains map[string]*DomainRecords) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Domains = domains
}

// Lookup 检索 DNS 记录 (高性能内存读取，DNS热通道)
func (s *MemoryStore) Lookup(domain, subdomain, qType, isp string) ([]string, uint32) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	dom, exists := s.Domains[domain]
	if !exists {
		return nil, 0
	}

	key := subdomain + "_" + qType
	records, found := dom.Records[key]
	if !found {
		return nil, 0
	}

	for _, r := range records {
		if r.ISP == isp && len(r.Values) > 0 {
			return r.Values, r.TTL
		}
	}
	for _, r := range records {
		if r.ISP == "def" && len(r.Values) > 0 {
			return r.Values, r.TTL
		}
	}
	if len(records) > 0 && len(records[0].Values) > 0 {
		return records[0].Values, records[0].TTL
	}
	return nil, 0
}

// AddRecord 独立服务器及向前兼容的普通添加方法
func (s *MemoryStore) AddRecord(domain, subdomain, qtype, isp string, values []string, ttl uint32) {
	_ = s.AddRecordWithAuth(1, "admin", domain, subdomain, qtype, isp, values, ttl)
}

// AddRecordWithAuth 带权限控制添加解析记录
func (s *MemoryStore) AddRecordWithAuth(userID int64, role string, domain, subdomain, qtype, isp string, values []string, ttl uint32) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dom, exists := s.Domains[domain]
	if exists {
		if role != "admin" && dom.OwnerID != userID {
			return fmt.Errorf("无权限修改该域名解析")
		}
	} else {
		var plan string
		var expiresAt int64
		err := s.db.QueryRow("SELECT plan, expires_at FROM users WHERE id = ?", userID).Scan(&plan, &expiresAt)
		if err != nil {
			return fmt.Errorf("获取账户信息失败")
		}

		// 检查过期时间（非 free 套餐且已到期）
		if plan != "free" && plan != "" && expiresAt > 0 && time.Now().Unix() > expiresAt {
			return fmt.Errorf("您的套餐服务已到期，请前往系统充值/续费后继续添加域名！")
		}

		// 统计当前用户拥有的域名数量
		var currentCount int
		err = s.db.QueryRow("SELECT COUNT(*) FROM domains WHERE owner_id = ?", userID).Scan(&currentCount)
		if err != nil {
			return fmt.Errorf("获取已托管域名数失败")
		}

		// 获取套餐上限
		limitStr := "1"
		if plan == "free" || plan == "" {
			limitStr = s.getSettingNoLock("plan_free_domain_limit", "1")
		} else if plan == "junior" {
			limitStr = s.getSettingNoLock("plan_junior_domain_limit", "1")
		} else if plan == "intermediate" {
			limitStr = s.getSettingNoLock("plan_intermediate_domain_limit", "3")
		} else if plan == "senior" {
			limitStr = s.getSettingNoLock("plan_senior_domain_limit", "6")
		}

		limit, _ := strconv.Atoi(limitStr)
		if currentCount >= limit {
			return fmt.Errorf("您的域名托管数量已达当前套餐上限 (%d 个)！请升级套餐", limit)
		}

		dom = &DomainRecords{
			OwnerID: userID,
			TTL:     ttl,
			Records: make(map[string][]DNSRecord),
		}
		s.Domains[domain] = dom
	}

	key := subdomain + "_" + qtype
	records := dom.Records[key]

	updated := false
	for i, rec := range records {
		if rec.ISP == isp {
			records[i].Values = values
			records[i].TTL = ttl
			updated = true
			break
		}
	}

	if !updated {
		records = append(records, DNSRecord{
			Subdomain: subdomain,
			Type:      qtype,
			ISP:       isp,
			Values:    values,
			TTL:       ttl,
		})
	}

	dom.Records[key] = records

	// 同步写入 SQLite
	if s.db != nil {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		_, _ = tx.Exec("INSERT OR IGNORE INTO domains (name, owner_id, ttl) VALUES (?, ?, ?)", domain, dom.OwnerID, ttl)
		var domID int64
		err = tx.QueryRow("SELECT id FROM domains WHERE name = ?", domain).Scan(&domID)
		if err != nil {
			return err
		}

		_, _ = tx.Exec("DELETE FROM dns_records WHERE domain_id = ? AND subdomain = ? AND type = ? AND isp = ?", domID, subdomain, qtype, isp)

		valsText := strings.Join(values, ",")
		_, err = tx.Exec("INSERT INTO dns_records (domain_id, subdomain, type, isp, values_text, ttl) VALUES (?, ?, ?, ?, ?, ?)",
			domID, subdomain, qtype, isp, valsText, ttl)
		if err != nil {
			return err
		}

		return tx.Commit()
	}
	return nil
}

// DeleteRecord 独立服务器及向前兼容的普通删除方法
func (s *MemoryStore) DeleteRecord(domain, subdomain, qtype, isp string) {
	_ = s.DeleteRecordWithAuth(1, "admin", domain, subdomain, qtype, isp)
}

// DeleteRecordWithAuth 带权限控制删除解析记录
func (s *MemoryStore) DeleteRecordWithAuth(userID int64, role string, domain, subdomain, qtype, isp string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dom, exists := s.Domains[domain]
	if !exists {
		return fmt.Errorf("域名未托管")
	}
	if role != "admin" && dom.OwnerID != userID {
		return fmt.Errorf("无权限修改该域名解析")
	}

	key := subdomain + "_" + qtype
	records, found := dom.Records[key]
	if !found {
		return nil
	}

	var newRecords []DNSRecord
	for _, rec := range records {
		if rec.ISP != isp {
			newRecords = append(newRecords, rec)
		}
	}

	if len(newRecords) == 0 {
		delete(dom.Records, key)
	} else {
		dom.Records[key] = newRecords
	}

	// 同步写入 SQLite
	if s.db != nil {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		var domID int64
		err = tx.QueryRow("SELECT id FROM domains WHERE name = ?", domain).Scan(&domID)
		if err == nil {
			_, _ = tx.Exec("DELETE FROM dns_records WHERE domain_id = ? AND subdomain = ? AND type = ? AND isp = ?", domID, subdomain, qtype, isp)

			if len(dom.Records) == 0 {
				delete(s.Domains, domain)
				_, _ = tx.Exec("DELETE FROM domains WHERE id = ?", domID)
			}
		}
		return tx.Commit()
	}
	return nil
}

// UpdateDDNS 通过 Token 更新动态 IP (同步更新数据库)
func (s *MemoryStore) UpdateDDNS(token, ip string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	target, exists := s.Tokens[token]
	if !exists {
		return "", fmt.Errorf("Token 无效")
	}

	parts := strings.Split(target, "_")
	if len(parts) < 2 {
		return "", fmt.Errorf("Token 配置已损坏")
	}
	fqdn := parts[0]
	isp := parts[1]

	var domain, subdomain string
	for dom := range s.Domains {
		if fqdn == dom {
			domain = dom
			subdomain = "@"
			break
		}
		if strings.HasSuffix(fqdn, "."+dom) {
			domain = dom
			subdomain = fqdn[:len(fqdn)-len(dom)-1]
			break
		}
	}

	if domain == "" {
		return "", fmt.Errorf("找不到对应的托管主域名")
	}

	dom := s.Domains[domain]
	key := subdomain + "_A"
	records := dom.Records[key]

	updated := false
	for i, rec := range records {
		if rec.ISP == isp {
			records[i].Values = []string{ip}
			updated = true
			break
		}
	}

	if !updated {
		records = append(records, DNSRecord{
			Subdomain: subdomain,
			Type:      "A",
			ISP:       isp,
			Values:    []string{ip},
			TTL:       60,
		})
	}

	dom.Records[key] = records

	// 同步写入 SQLite
	if s.db != nil {
		tx, err := s.db.Begin()
		if err != nil {
			return "", err
		}
		defer tx.Rollback()

		var domID int64
		err = tx.QueryRow("SELECT id FROM domains WHERE name = ?", domain).Scan(&domID)
		if err != nil {
			return "", err
		}

		_, _ = tx.Exec("DELETE FROM dns_records WHERE domain_id = ? AND subdomain = ? AND type = 'A' AND isp = ?", domID, subdomain, isp)
		_, err = tx.Exec("INSERT INTO dns_records (domain_id, subdomain, type, isp, values_text, ttl) VALUES (?, ?, 'A', ?, ?, 60)",
			domID, subdomain, isp, ip)
		if err != nil {
			return "", err
		}

		_ = tx.Commit()
	}

	return fqdn + " (" + strings.ToUpper(isp) + ")", nil
}

// RegisterUser 注册新用户
func (s *MemoryStore) RegisterUser(username, password, role string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return fmt.Errorf("数据库未初始化")
	}

	var exists int
	err := s.db.QueryRow("SELECT COUNT(*) FROM users WHERE username = ?", username).Scan(&exists)
	if err != nil {
		return err
	}
	if exists > 0 {
		return fmt.Errorf("用户名已被占用")
	}

	_, err = s.db.Exec("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", username, password, role)
	return err
}

// CreateSession 创建用户 Session Token 并入库
func (s *MemoryStore) CreateSession(username, password string) (string, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return "", "", fmt.Errorf("数据库未初始化")
	}

	var userID int64
	var role string
	err := s.db.QueryRow("SELECT id, role FROM users WHERE username = ? AND password_hash = ?", username, password).Scan(&userID, &role)
	if err != nil {
		return "", "", fmt.Errorf("用户名或密码错误")
	}

	// 随机生成 32 字符的十六进制 Token
	tokenBytes := make([]byte, 16)
	_, _ = rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	// Session 过期时间：7天
	expiresAt := time.Now().Add(7 * 24 * time.Hour).Unix()

	_, err = s.db.Exec("INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, userID, expiresAt)
	if err != nil {
		return "", "", err
	}

	return token, role, nil
}

// AuthenticateToken 认证会话 Token，返回用户对象
func (s *MemoryStore) AuthenticateToken(token string) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}

	var u User
	var expiresAt int64
	query := `
	SELECT u.id, u.username, u.role, u.plan, u.expires_at, s.expires_at 
	FROM user_sessions s
	JOIN users u ON s.user_id = u.id
	WHERE s.token = ?
	`
	err := s.db.QueryRow(query, token).Scan(&u.ID, &u.Username, &u.Role, &u.Plan, &u.ExpiresAt, &expiresAt)
	if err != nil {
		return nil, fmt.Errorf("会话 Token 无效")
	}

	if time.Now().Unix() > expiresAt {
		return nil, fmt.Errorf("登录会话已过期，请重新登录")
	}

	return &u, nil
}

// DestroySession 注销 Session
func (s *MemoryStore) DestroySession(token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return nil
	}

	_, err := s.db.Exec("DELETE FROM user_sessions WHERE token = ?", token)
	return err
}

// UpdateUserPassword 修改用户密码
func (s *MemoryStore) UpdateUserPassword(userID int64, oldPass, newPass string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return fmt.Errorf("数据库未初始化")
	}

	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM users WHERE id = ? AND password_hash = ?", userID, oldPass).Scan(&count)
	if err != nil || count == 0 {
		return fmt.Errorf("当前密码错误")
	}

	_, err = s.db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", newPass, userID)
	return err
}

// GenerateDDNSToken 为用户域名生成新的 DDNS Token
func (s *MemoryStore) GenerateDDNSToken(userID int64, role string, fqdn, isp string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var domain string
	for dom := range s.Domains {
		if fqdn == dom || strings.HasSuffix(fqdn, "."+dom) {
			domain = dom
			break
		}
	}
	if domain == "" {
		return "", fmt.Errorf("该域名未在本系统托管")
	}

	domObj := s.Domains[domain]
	if role != "admin" && domObj.OwnerID != userID {
		return "", fmt.Errorf("无权限为该域名生成 DDNS Token")
	}

	tokenBytes := make([]byte, 16)
	_, _ = rand.Read(tokenBytes)
	token := "ddns_tok_" + hex.EncodeToString(tokenBytes)[:16]

	target := fqdn + "_" + isp
	s.Tokens[token] = target

	if s.db != nil {
		_, err := s.db.Exec("INSERT OR REPLACE INTO ddns_tokens (token, record_info) VALUES (?, ?)", token, target)
		if err != nil {
			return "", err
		}
	}
	return token, nil
}

// DeleteDDNSToken 删除指定 Token
func (s *MemoryStore) DeleteDDNSToken(userID int64, role string, token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	target, exists := s.Tokens[token]
	if !exists {
		return fmt.Errorf("Token 不存在")
	}

	parts := strings.Split(target, "_")
	if len(parts) < 2 {
		return fmt.Errorf("Token 格式损坏")
	}
	fqdn := parts[0]

	var domain string
	for dom := range s.Domains {
		if fqdn == dom || strings.HasSuffix(fqdn, "."+dom) {
			domain = dom
			break
		}
	}

	if domain != "" {
		domObj := s.Domains[domain]
		if role != "admin" && domObj.OwnerID != userID {
			return fmt.Errorf("无权限删除该域名下的 Token")
		}
	}

	delete(s.Tokens, token)

	if s.db != nil {
		_, err := s.db.Exec("DELETE FROM ddns_tokens WHERE token = ?", token)
		return err
	}
	return nil
}

func (s *MemoryStore) GetSetting(key string, defaultVal string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.getSettingNoLock(key, defaultVal)
}

func (s *MemoryStore) getSettingNoLock(key string, defaultVal string) string {
	if s.db == nil {
		return defaultVal
	}

	var val string
	err := s.db.QueryRow("SELECT value FROM sys_settings WHERE key = ?", key).Scan(&val)
	if err != nil {
		return defaultVal
	}
	return val
}

// SetSetting 设置系统配置项
func (s *MemoryStore) SetSetting(key string, val string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return fmt.Errorf("数据库未初始化")
	}

	_, err := s.db.Exec("INSERT OR REPLACE INTO sys_settings (key, value) VALUES (?, ?)", key, val)
	return err
}

// Close 关闭底层数据库连接
func (s *MemoryStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		err := s.db.Close()
		s.db = nil
		return err
	}
	return nil
}

func (s *MemoryStore) initDefaultData() {
	s.Domains["example.com"] = &DomainRecords{
		OwnerID: 1, // 默认为 admin 拥有
		TTL:     60,
		Records: map[string][]DNSRecord{
			"www_A": {
				{Subdomain: "www", Type: "A", ISP: "ct", Values: []string{"1.1.1.1"}, TTL: 60},
				{Subdomain: "www", Type: "A", ISP: "cu", Values: []string{"2.2.2.2"}, TTL: 60},
				{Subdomain: "www", Type: "A", ISP: "cm", Values: []string{"3.3.3.3"}, TTL: 60},
				{Subdomain: "www", Type: "A", ISP: "def", Values: []string{"4.4.4.4"}, TTL: 60},
			},
			"ipv6_AAAA": {
				{Subdomain: "ipv6", Type: "AAAA", ISP: "def", Values: []string{"240e:c2:2000::1"}, TTL: 600},
			},
		},
	}
	s.Tokens["ddns_tok_demo123456"] = "www.example.com_ct"
}

// CreateOrder 创建充值/套餐购买订单
func (s *MemoryStore) CreateOrder(orderID string, userID int64, plan, cycle string, price float64, payMethod string, durationDays int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return fmt.Errorf("数据库未初始化")
	}

	now := time.Now().Unix()
	query := `
	INSERT INTO orders (order_id, user_id, plan, cycle, price, payment_method, status, tx_id, created_at, updated_at, duration_days)
	VALUES (?, ?, ?, ?, ?, ?, 'pending', '', ?, ?, ?)
	`
	_, err := s.db.Exec(query, orderID, userID, plan, cycle, price, payMethod, now, now, durationDays)
	return err
}

// GetOrder 获取订单详情
func (s *MemoryStore) GetOrder(orderID string) (map[string]interface{}, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}

	var userID int64
	var plan, cycle, payMethod, status, txID string
	var price float64
	var durationDays int
	var createdAt int64

	query := "SELECT user_id, plan, cycle, price, payment_method, status, tx_id, created_at, duration_days FROM orders WHERE order_id = ?"
	err := s.db.QueryRow(query, orderID).Scan(&userID, &plan, &cycle, &price, &payMethod, &status, &txID, &createdAt, &durationDays)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"order_id":       orderID,
		"user_id":        userID,
		"plan":           plan,
		"cycle":          cycle,
		"price":          price,
		"payment_method": payMethod,
		"status":         status,
		"tx_id":          txID,
		"created_at":     createdAt,
		"duration_days":  durationDays,
	}, nil
}

// MarkOrderPaid 将订单标记为已支付，并为用户开通/续期套餐
func (s *MemoryStore) MarkOrderPaid(orderID string, txID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return fmt.Errorf("数据库未初始化")
	}

	// 1. 获取订单详情
	var userID int64
	var plan, status string
	var durationDays int
	err := s.db.QueryRow("SELECT user_id, plan, status, duration_days FROM orders WHERE order_id = ?", orderID).Scan(&userID, &plan, &status, &durationDays)
	if err != nil {
		return fmt.Errorf("订单不存在: %w", err)
	}

	if status == "paid" {
		return nil // 已经处理过了，直接返回成功
	}

	// 2. 获取用户当前套餐和过期时间
	var currentPlan string
	var currentExpiresAt int64
	err = s.db.QueryRow("SELECT plan, expires_at FROM users WHERE id = ?", userID).Scan(&currentPlan, &currentExpiresAt)
	if err != nil {
		return fmt.Errorf("获取用户信息失败: %w", err)
	}

	now := time.Now().Unix()
	var newExpiresAt int64

	// 如果用户的套餐跟订单买的套餐一致，且当前套餐未到期，则在当前过期时间基础上累加
	if currentPlan == plan && currentExpiresAt > now {
		newExpiresAt = currentExpiresAt + int64(durationDays*24*3600)
	} else {
		// 否则，从当前时间算起
		newExpiresAt = now + int64(durationDays*24*3600)
	}

	// 3. 开始事务更新订单状态和用户权限
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 更新订单状态
	_, err = tx.Exec("UPDATE orders SET status = 'paid', tx_id = ?, updated_at = ? WHERE order_id = ?", txID, now, orderID)
	if err != nil {
		return err
	}

	// 更新用户套餐与过期时间
	_, err = tx.Exec("UPDATE users SET plan = ?, expires_at = ? WHERE id = ?", plan, newExpiresAt, userID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// IsTxIDUsed 判断 USDT Hash (TxID) 是否已经被其他订单使用过
func (s *MemoryStore) IsTxIDUsed(txID string) (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return false, fmt.Errorf("数据库未初始化")
	}

	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM orders WHERE tx_id = ? AND status = 'paid'", txID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// GetUserProfileFull 获取用户详细个人中心数据
func (s *MemoryStore) GetUserProfileFull(userID int64) (map[string]interface{}, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}

	var u User
	var autoRenewInt int
	err := s.db.QueryRow("SELECT id, username, role, plan, expires_at, balance, auto_renew, telegram_id FROM users WHERE id = ?", userID).Scan(
		&u.ID, &u.Username, &u.Role, &u.Plan, &u.ExpiresAt, &u.Balance, &autoRenewInt, &u.TelegramID,
	)
	if err != nil {
		return nil, err
	}
	u.AutoRenew = (autoRenewInt == 1)

	var domainCount int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM domains WHERE owner_id = ?", userID).Scan(&domainCount)

	limitStr := "1"
	if u.Plan == "free" || u.Plan == "" {
		limitStr = s.getSettingNoLock("plan_free_domain_limit", "1")
	} else if u.Plan == "junior" {
		limitStr = s.getSettingNoLock("plan_junior_domain_limit", "1")
	} else if u.Plan == "intermediate" {
		limitStr = s.getSettingNoLock("plan_intermediate_domain_limit", "3")
	} else if u.Plan == "senior" {
		limitStr = s.getSettingNoLock("plan_senior_domain_limit", "6")
	}
	domainLimit, _ := strconv.Atoi(limitStr)

	// 计算月付续费价格
	renewPriceStr := "0"
	if u.Plan == "junior" {
		renewPriceStr = s.getSettingNoLock("plan_junior_price_monthly", "10")
	} else if u.Plan == "intermediate" {
		renewPriceStr = s.getSettingNoLock("plan_intermediate_price_monthly", "20")
	} else if u.Plan == "senior" {
		renewPriceStr = s.getSettingNoLock("plan_senior_price_monthly", "40")
	}

	return map[string]interface{}{
		"id":           u.ID,
		"username":     u.Username,
		"role":         u.Role,
		"plan":         u.Plan,
		"expires_at":   u.ExpiresAt,
		"balance":      u.Balance,
		"auto_renew":   u.AutoRenew,
		"telegram_id":  u.TelegramID,
		"domain_count": domainCount,
		"domain_limit": domainLimit,
		"renew_price":  renewPriceStr,
	}, nil
}

// UpdateAutoRenew 更新用户的自动续费设置
func (s *MemoryStore) UpdateAutoRenew(userID int64, autoRenew bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return fmt.Errorf("数据库未初始化")
	}

	val := 0
	if autoRenew {
		val = 1
	}
	_, err := s.db.Exec("UPDATE users SET auto_renew = ? WHERE id = ?", val, userID)
	return err
}

// GetDB 获取底层 SQLite 数据库连接对象
func (s *MemoryStore) GetDB() *sql.DB {
	return s.db
}
