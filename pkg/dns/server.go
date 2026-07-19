package dns

import (
	"log"
	"net"
	"strings"
	"trinet-dns/pkg/geoip"
	"trinet-dns/pkg/store"

	"github.com/miekg/dns"
)

type DNSServer struct {
	addr    string
	store   *store.MemoryStore
	route   *geoip.ISPRoutingMap
	server  *dns.Server
	logChan chan string // 用于向日志系统推送实时解析日志
}

func NewDNSServer(addr string, s *store.MemoryStore, r *geoip.ISPRoutingMap, logChan chan string) *DNSServer {
	return &DNSServer{
		addr:    addr,
		store:   s,
		route:   r,
		logChan: logChan,
	}
}

func (d *DNSServer) Start() {
	dns.HandleFunc(".", d.handleDNSRequest)

	d.server = &dns.Server{Addr: d.addr, Net: "udp"}
	log.Printf("[INFO] DNS 服务器正在启动，监听在 UDP %s", d.addr)
	go func() {
		if err := d.server.ListenAndServe(); err != nil {
			log.Fatalf("[FATAL] DNS 服务器运行失败: %s", err.Error())
		}
	}()
}

func (d *DNSServer) Stop() {
	if d.server != nil {
		d.server.Shutdown()
	}
}

func (d *DNSServer) handleDNSRequest(w dns.ResponseWriter, r *dns.Msg) {
	m := new(dns.Msg)
	m.SetReply(r)
	m.Compress = true

	if len(r.Question) == 0 {
		w.WriteMsg(m)
		return
	}

	q := r.Question[0]
	qTypeStr := dns.TypeToString[q.Qtype]

	// 1. 获取客户端 IP (优先使用 ECS, 其次使用 Socket 源 IP)
	clientIP, isECS := getClientIP(r, w.RemoteAddr())
	isp := "def"
	if clientIP != nil {
		isp = d.route.Lookup(clientIP)
	}
	d.store.RecordQuery(isp)

	// 2. 切分域名和主机记录
	subdomain, domain := d.splitQName(q.Name)

	var logMsg string
	if domain != "" {
		// 3. 查库获取解析值
		ips, ttl := d.store.Lookup(domain, subdomain, qTypeStr, isp)
		if len(ips) > 0 {
			for _, ipStr := range ips {
				hdr := dns.RR_Header{Name: q.Name, Rrtype: q.Qtype, Class: dns.ClassINET, Ttl: ttl}
				switch q.Qtype {
				case dns.TypeA:
					m.Answer = append(m.Answer, &dns.A{Hdr: hdr, A: net.ParseIP(ipStr)})
				case dns.TypeAAAA:
					m.Answer = append(m.Answer, &dns.AAAA{Hdr: hdr, AAAA: net.ParseIP(ipStr)})
				case dns.TypeCNAME:
					m.Answer = append(m.Answer, &dns.CNAME{Hdr: hdr, Target: dns.Fqdn(ipStr)})
				}
			}
			logMsg = "[QUERY] IP: " + clientIP.String() + " (ECS: " + strings.ToUpper(isp) + ") -> 查询: " + q.Name + " " + qTypeStr + " -> 成功匹配线路: " + strings.Join(ips, ", ")
		} else {
			logMsg = "[QUERY] IP: " + clientIP.String() + " (ECS: " + strings.ToUpper(isp) + ") -> 查询: " + q.Name + " " + qTypeStr + " -> 无匹配记录"
		}
	} else {
		logMsg = "[QUERY] IP: " + clientIP.String() + " -> 查询非托管域名: " + q.Name
	}

	// 发送解析日志到 Web 后台展示，同时输出到系统控制台
	log.Println(logMsg)
	select {
	case d.logChan <- logMsg:
	default:
	}

	// 携带 ECS 的应答响应 (如果客户端发送了 ECS，权威 DNS 应答中也最好带上以优化公共 DNS 缓存)
	if isECS {
		d.appendECSResponse(r, m, clientIP)
	}

	w.WriteMsg(m)
}

// getClientIP 提取请求的真实源 IP
func getClientIP(r *dns.Msg, remoteAddr net.Addr) (net.IP, bool) {
	opt := r.IsEdns0()
	if opt != nil {
		for _, option := range opt.Option {
			if ecs, ok := option.(*dns.EDNS0_SUBNET); ok {
				return ecs.Address, true
			}
		}
	}
	// Fallback
	host, _, err := net.SplitHostPort(remoteAddr.String())
	if err == nil {
		return net.ParseIP(host), false
	}
	return nil, false
}

// splitQName 将 "www.example.com." 切分为 subdomain="www", domain="example.com"
func (d *DNSServer) splitQName(qname string) (string, string) {
	qname = strings.TrimSuffix(strings.ToLower(qname), ".")

	for _, dom := range d.store.GetDomains() {
		if qname == dom {
			return "@", dom
		}
		if strings.HasSuffix(qname, "."+dom) {
			prefix := qname[:len(qname)-len(dom)-1]
			return prefix, dom
		}
	}
	return "", ""
}

// appendECSResponse 应答报文中带上 ECS 标识，优化客户端本地/公共 DNS 缓存范围
func (d *DNSServer) appendECSResponse(req *dns.Msg, resp *dns.Msg, clientIP net.IP) {
	opt := req.IsEdns0()
	if opt == nil {
		return
	}

	var reqECS *dns.EDNS0_SUBNET
	for _, option := range opt.Option {
		if ecs, ok := option.(*dns.EDNS0_SUBNET); ok {
			reqECS = ecs
			break
		}
	}
	if reqECS == nil {
		return
	}

	// 创建应答的 OPT 记录
	o := new(dns.OPT)
	o.Hdr.Name = "."
	o.Hdr.Rrtype = dns.TypeOPT
	
	respECS := new(dns.EDNS0_SUBNET)
	respECS.Code = dns.EDNS0SUBNET
	respECS.Family = reqECS.Family
	respECS.SourceNetmask = reqECS.SourceNetmask
	respECS.SourceScope = reqECS.SourceNetmask // 设置为与请求源掩码一致
	respECS.Address = clientIP

	o.Option = append(o.Option, respECS)
	resp.Extra = append(resp.Extra, o)
}
