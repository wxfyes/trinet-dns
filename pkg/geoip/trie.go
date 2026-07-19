package geoip

import (
	"net"
)

// TrieNode 表示 IP 匹配树的节点
type TrieNode struct {
	children [2]*TrieNode
	isp      string // "ct", "cu", "cm", "def"
}

// ISPRoutingMap 提供三网 IP 前缀匹配树
type ISPRoutingMap struct {
	root *TrieNode
}

// NewISPRoutingMap 创建一个新的路由匹配树
func NewISPRoutingMap() *ISPRoutingMap {
	return &ISPRoutingMap{root: &TrieNode{}}
}

// InsertCIDR 向匹配树中插入一个网段及对应的运营商
func (t *ISPRoutingMap) InsertCIDR(cidrStr string, isp string) error {
	_, ipNet, err := net.ParseCIDR(cidrStr)
	if err != nil {
		return err
	}

	ip := ipNet.IP.To4()
	if ip == nil {
		// 目前优先支持 IPv4 三网路由，若有 IPv6 也可在此处处理
		return nil
	}

	ones, _ := ipNet.Mask.Size()
	curr := t.root

	for i := 0; i < ones; i++ {
		byteIdx := i / 8
		bitIdx := 7 - (i % 8)
		bit := (ip[byteIdx] >> bitIdx) & 1

		if curr.children[bit] == nil {
			curr.children[bit] = &TrieNode{}
		}
		curr = curr.children[bit]
	}
	curr.isp = isp
	return nil
}

// Lookup 查找指定 IP 归属的运营商，最长前缀匹配 (LPM)
func (t *ISPRoutingMap) Lookup(ip net.IP) string {
	ip4 := ip.To4()
	if ip4 == nil {
		return "def"
	}

	curr := t.root
	lastMatchISP := "def"

	for i := 0; i < 32; i++ {
		if curr.isp != "" {
			lastMatchISP = curr.isp
		}

		byteIdx := i / 8
		bitIdx := 7 - (i % 8)
		bit := (ip4[byteIdx] >> bitIdx) & 1

		if curr.children[bit] == nil {
			break
		}
		curr = curr.children[bit]
	}

	if curr != nil && curr.isp != "" {
		lastMatchISP = curr.isp
	}

	return lastMatchISP
}
