package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"

	_ "github.com/glebarez/go-sqlite"
)

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
	`
	if _, err := s.db.Exec(query); err != nil {
		return fmt.Errorf("failed to init db tables: %w", err)
	}

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
		_, err = tx.Exec("INSERT OR IGNORE INTO domains (name, ttl) VALUES (?, ?)", domName, domObj.TTL)
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
			_, err = tx.Exec("INSERT OR IGNORE INTO domains (name, ttl) VALUES (?, ?)", domName, domObj.TTL)
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
	domRows, err := s.db.Query("SELECT id, name, ttl FROM domains")
	if err != nil {
		return err
	}
	defer domRows.Close()

	s.Domains = make(map[string]*DomainRecords)

	type dbDom struct {
		id   int64
		name string
		ttl  uint32
	}
	var dbDoms []dbDom
	for domRows.Next() {
		var d dbDom
		if err := domRows.Scan(&d.id, &d.name, &d.ttl); err != nil {
			return err
		}
		dbDoms = append(dbDoms, d)
		s.Domains[d.name] = &DomainRecords{
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

// AddRecord 添加/更新解析记录 (线程安全，同步写入数据库)
func (s *MemoryStore) AddRecord(domain, subdomain, qtype, isp string, values []string, ttl uint32) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dom, exists := s.Domains[domain]
	if !exists {
		dom = &DomainRecords{
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
			return
		}
		defer tx.Rollback()

		_, _ = tx.Exec("INSERT OR IGNORE INTO domains (name, ttl) VALUES (?, ?)", domain, ttl)
		var domID int64
		err = tx.QueryRow("SELECT id FROM domains WHERE name = ?", domain).Scan(&domID)
		if err != nil {
			return
		}

		_, _ = tx.Exec("DELETE FROM dns_records WHERE domain_id = ? AND subdomain = ? AND type = ? AND isp = ?", domID, subdomain, qtype, isp)

		valsText := strings.Join(values, ",")
		_, err = tx.Exec("INSERT INTO dns_records (domain_id, subdomain, type, isp, values_text, ttl) VALUES (?, ?, ?, ?, ?, ?)",
			domID, subdomain, qtype, isp, valsText, ttl)
		if err != nil {
			return
		}

		_ = tx.Commit()
	}
}

// DeleteRecord 删除解析记录 (线程安全，同步删除数据库)
func (s *MemoryStore) DeleteRecord(domain, subdomain, qtype, isp string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dom, exists := s.Domains[domain]
	if !exists {
		return
	}

	key := subdomain + "_" + qtype
	records, found := dom.Records[key]
	if !found {
		return
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
			return
		}
		defer tx.Rollback()

		var domID int64
		err = tx.QueryRow("SELECT id FROM domains WHERE name = ?", domain).Scan(&domID)
		if err == nil {
			_, _ = tx.Exec("DELETE FROM dns_records WHERE domain_id = ? AND subdomain = ? AND type = ? AND isp = ?", domID, subdomain, qtype, isp)
			
			// 如果该域名下已经没有任何记录了，也可以在数据库和内存中清理掉该域名
			if len(dom.Records) == 0 {
				delete(s.Domains, domain)
				_, _ = tx.Exec("DELETE FROM domains WHERE id = ?", domID)
			}
		}
		_ = tx.Commit()
	}
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

func (s *MemoryStore) initDefaultData() {
	s.Domains["example.com"] = &DomainRecords{
		TTL: 60,
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
