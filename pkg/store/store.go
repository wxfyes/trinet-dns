package store

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
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

// MemoryStore 内存解析记录存储（支持持久化为 JSON 文件）
type MemoryStore struct {
	mu       sync.RWMutex
	filePath string
	Domains  map[string]*DomainRecords `json:"domains"`
	Tokens   map[string]string         `json:"tokens"` // key: token, value: subdomain.domain_isp
	WebUser  string                    `json:"web_user,omitempty"`
	WebPass  string                    `json:"web_pass,omitempty"`
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
	return s.saveUnlocked()
}

func NewMemoryStore(filePath string) *MemoryStore {
	store := &MemoryStore{
		filePath: filePath,
		Domains:  make(map[string]*DomainRecords),
		Tokens:   make(map[string]string),
	}
	store.Load()
	return store
}

// Load 从 JSON 文件加载数据
func (s *MemoryStore) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.filePath == "" {
		return nil
	}

	data, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			s.initDefaultData()
			return s.saveUnlocked()
		}
		return err
	}

	return json.Unmarshal(data, s)
}

func (s *MemoryStore) saveUnlocked() error {
	if s.filePath == "" {
		return nil
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath, data, 0644)
}

// MarshalJSON 实现自定义 thread-safe 序列化
func (s *MemoryStore) MarshalJSON() ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return json.Marshal(struct {
		Domains map[string]*DomainRecords `json:"domains"`
		Tokens  map[string]string         `json:"tokens"`
	}{
		Domains: s.Domains,
		Tokens:  s.Tokens,
	})
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

// LoadDataFromMap 同步时写入数据
func (s *MemoryStore) LoadDataFromMap(domains map[string]*DomainRecords) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Domains = domains
}

// Lookup 检索 DNS 记录
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

// AddRecord 添加/更新解析记录 (线程安全)
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
	s.saveUnlocked()
}

// DeleteRecord 删除解析记录 (线程安全)
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
	s.saveUnlocked()
}

// UpdateDDNS 通过 Token 更新动态 IP
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
	s.saveUnlocked()
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
