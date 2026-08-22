package main

import (
	"fmt"
	"github.com/miekg/dns"
)

func main() {
	records := []struct {
		name  string
		ttl   uint32
		qtype string
		val   string
	}{
		{"example.com.", 600, "TXT", "\"v=spf1 -all\""},
		{"example.com.", 600, "NS", "ns1.example.com."},
		{"example.com.", 600, "MX", "10 mail.example.com."},
		{"example.com.", 600, "HTTPS", "1 . alpn=\"h2,h3\""},
		{"example.com.", 600, "A", "1.2.3.4"},
	}

	for _, r := range records {
		rrStr := fmt.Sprintf("%s %d IN %s %s", r.name, r.ttl, r.qtype, r.val)
		rr, err := dns.NewRR(rrStr)
		if err != nil {
			fmt.Printf("Error parsing %s: %v\n", r.qtype, err)
		} else {
			fmt.Printf("Parsed %s: %v\n", r.qtype, rr)
		}
	}
}
